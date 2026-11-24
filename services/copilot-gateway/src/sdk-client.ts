/**
 * The real @microsoft/copilot-sdk behind the CopilotClientLike interface.
 *
 * The only file that imports the SDK. Verified against 2.0.1's type
 * declarations:
 *   - `new CopilotClient({ mode: "empty", sessionFs, observability })`: "empty"
 *     is the SDK's multi-user server mode (no ambient CLI tools, no
 *     cross-session store); `sessionFs` routes session state to an in-memory
 *     provider instead of the runtime's directory.
 *   - per session: `github.tokenProvider` (the caller's token, this session
 *     only), `tools.definitions` with no handler (declaration-only, answered
 *     through `session.rpc.tools.handlePendingToolCall`) and
 *     `tools.availableTools` limited to exactly those names.
 *   - `state.enableCrossSessionStore: false` and an in-memory embedding cache,
 *     so nothing about one user's session is retrievable from another's.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CopilotClient,
  type CreateSessionOptions,
  type PermissionHandler,
  type SessionFsProvider,
} from '@microsoft/copilot-sdk'
import type { CopilotClientLike, SessionLike, TurnSessionSpec } from './turns.js'
import { MemorySessionFs } from './memory-session-fs.js'

const JSON_ONLY_INSTRUCTION =
  'You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.'

/** Session tokens are minted per turn; the runtime needs more than an hour left. */
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60

/** Only declared tools exist (availableTools), and they skip permission. Refuse anything else. */
const refuseUndeclared: PermissionHandler = () => ({
  kind: 'reject',
  feedback: 'Only the tools declared for this turn are available.',
})

// Compile-time check that the in-memory filesystem fits the SDK's provider type.
const _fsFits: (fs: MemorySessionFs) => SessionFsProvider = (fs) => fs
void _fsFits

export function sessionOptions(spec: TurnSessionSpec): CreateSessionOptions {
  return {
    model: spec.model,
    github: {
      tokenProvider: async () => ({
        kind: 'token',
        accessToken: spec.githubToken(),
        expiresIn: TOKEN_LIFETIME_SECONDS,
      }),
      telemetryEnabled: false,
    },
    tools: {
      definitions: spec.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        skipPermission: true,
      })),
      availableTools: spec.tools.map((t) => t.name),
    },
    permissions: { onRequest: refuseUndeclared },
    state: {
      enableCrossSessionStore: false,
      embeddingCacheStorage: 'in-memory',
      createSessionFsProvider: () => new MemorySessionFs(),
    },
    ...(spec.jsonOnly ? { systemMessage: { mode: 'append' as const, content: JSON_ONLY_INSTRUCTION } } : {}),
    ...(spec.maxTokens ? { inference: { capabilities: { limits: { max_output_tokens: spec.maxTokens } } } } : {}),
  }
}

export interface SdkClientHandle {
  client: CopilotClientLike
  sdkVersion: string
  runtimeVersion: () => Promise<string>
  stop: () => Promise<void>
}

/** The installed SDK's version, read from its package.json (not in its exports map). */
export function installedSdkVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve('@microsoft/copilot-sdk')))
    for (let i = 0; i < 5; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        if (pkg.name === '@microsoft/copilot-sdk') return String(pkg.version)
      } catch {
        // keep walking up
      }
      dir = dirname(dir)
    }
  } catch {
    // fall through
  }
  return 'unknown'
}

export async function startSdkClient(): Promise<SdkClientHandle> {
  const sdk = new CopilotClient({
    mode: 'empty',
    sessionFs: { initialCwd: '/', sessionStatePath: '/session-state', conventions: 'posix' },
    observability: { logLevel: 'none' },
    clientInfo: { applicationName: 'astrid-copilot-gateway' },
  })
  await sdk.start()

  let runtimeVersion: string | null = null
  return {
    sdkVersion: installedSdkVersion(),
    runtimeVersion: async () => {
      if (!runtimeVersion) runtimeVersion = (await sdk.getStatus()).version
      return runtimeVersion
    },
    stop: async () => {
      await sdk.stop()
    },
    client: {
      createSession: async (spec) => (await sdk.createSession(sessionOptions(spec))) as unknown as SessionLike,
      deleteSession: (sessionId) => sdk.deleteSession(sessionId),
    },
  }
}
