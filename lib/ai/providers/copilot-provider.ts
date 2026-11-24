/**
 * GitHub Copilot AI Provider
 *
 * Two paths, chosen per call by the environment:
 *
 * 1. The Copilot gateway (ADEV-245), when COPILOT_GATEWAY_URL and
 *    COPILOT_GATEWAY_SECRET are both set. The gateway runs
 *    @microsoft/copilot-sdk in its own container (services/copilot-gateway,
 *    docs/COPILOT_SDK_INTEGRATION_PLAN.md Phase 2), because the SDK's runtime
 *    is too big for a Vercel function and its only remote transport is
 *    plaintext TCP. This side makes HTTPS calls and nothing else. Once the
 *    gateway is configured a failure is an error ("Copilot gateway
 *    unavailable"), never a silent fall back to REST.
 *
 * 2. The REST path, otherwise. Copilot's chat API is OpenAI-compatible, so it is
 *    a thin wrapper over callOpenAI pointed at the Copilot endpoint with the
 *    integration headers Copilot requires. Phase 3 deletes it.
 *
 * Either way `apiKey` is the user's own GitHub token (resolved upstream by
 * copilotTokenFor), so entitlement follows that user's Copilot subscription.
 * Neither the token nor the gateway secret is ever logged.
 */

import { BRAND } from '@/lib/brand/config'
import { AI_REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../clients/fetch-with-timeout'
import type { AILogger } from '../types/logger'
import type {
  GatewayToolDeclaration,
  GatewayToolResult,
  GatewayTurnRequest,
  GatewayTurnResponse,
} from './copilot-gateway-contract'
import type { AIProviderResponse } from './types'
import { callOpenAI, OPENAI_REPOSITORY_TOOLS, type OpenAIProviderOptions } from './openai-provider'

export const COPILOT_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export type CopilotProviderOptions = OpenAIProviderOptions

export const COPILOT_DEFAULT_MODEL = 'gpt-4.1'
export const COPILOT_BASE_URL = 'https://api.githubcopilot.com'
export const COPILOT_HEADERS: Record<string, string> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': `${BRAND.appName}/1.0`,
}

/** The one message a gateway outage or timeout produces. */
export const COPILOT_GATEWAY_UNAVAILABLE = 'Copilot gateway unavailable'

/** Same cap as callOpenAI's tool loop. */
const MAX_GATEWAY_TURNS = 30

interface GatewayConfig {
  url: string
  secret: string
}

/** Both variables set, or no gateway. */
function gatewayConfig(): GatewayConfig | null {
  const url = process.env.COPILOT_GATEWAY_URL?.trim()
  const secret = process.env.COPILOT_GATEWAY_SECRET?.trim()
  if (!url || !secret) return null
  return { url: url.replace(/\/+$/, ''), secret }
}

export async function callCopilot(options: CopilotProviderOptions): Promise<AIProviderResponse> {
  const gateway = gatewayConfig()
  if (gateway) return callCopilotGateway(options, gateway)

  return callOpenAI({
    ...options,
    model: options.model ?? COPILOT_DEFAULT_MODEL,
    baseUrl: COPILOT_BASE_URL,
    extraHeaders: { ...COPILOT_HEADERS, ...(options.extraHeaders ?? {}) },
  })
}

const noopLogger: AILogger = () => {}

/** The repository tools as gateway declarations (name, description, JSON schema). */
function repositoryToolDeclarations(): GatewayToolDeclaration[] {
  return COPILOT_REPOSITORY_TOOLS.map(({ function: fn }) => ({
    name: fn.name,
    description: fn.description,
    parameters: fn.parameters,
  }))
}

async function postToGateway(
  gateway: GatewayConfig,
  path: string,
  body: unknown,
  logger: AILogger
): Promise<GatewayTurnResponse> {
  let response: Response
  try {
    response = await fetchWithTimeout(
      `${gateway.url}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gateway.secret}`,
        },
        body: JSON.stringify(body),
      },
      AI_REQUEST_TIMEOUT_MS,
      'Copilot gateway'
    )
  } catch (error) {
    logger('error', 'Copilot gateway request failed', {
      path,
      reason: error instanceof Error ? error.name : 'unknown',
    })
    throw new Error(COPILOT_GATEWAY_UNAVAILABLE)
  }

  if (response.status >= 500) {
    logger('error', 'Copilot gateway server error', { path, status: response.status })
    throw new Error(COPILOT_GATEWAY_UNAVAILABLE)
  }

  if (!response.ok) {
    // The gateway's error bodies are its own fixed strings, never echoed input.
    const detail = await response
      .json()
      .then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : ''))
      .catch(() => '')
    logger('error', 'Copilot gateway rejected the request', { path, status: response.status })
    throw new Error(`Copilot gateway error (${response.status})${detail ? `: ${detail.substring(0, 200)}` : ''}`)
  }

  const data = (await response.json().catch(() => null)) as GatewayTurnResponse | null
  if (!data || (data.status !== 'done' && data.status !== 'tool_calls')) {
    logger('error', 'Copilot gateway returned an unexpected body', { path })
    throw new Error(COPILOT_GATEWAY_UNAVAILABLE)
  }
  return data
}

async function callCopilotGateway(
  options: CopilotProviderOptions,
  gateway: GatewayConfig
): Promise<AIProviderResponse> {
  const {
    apiKey,
    prompt,
    maxTokens,
    jsonOnly = false,
    executeToolCallback,
    hasRepository = false,
    logger = noopLogger,
    model = COPILOT_DEFAULT_MODEL,
  } = options

  const useTools = hasRepository && !jsonOnly && !!executeToolCallback

  const request: GatewayTurnRequest = {
    githubToken: apiKey,
    model,
    prompt,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(jsonOnly ? { jsonOnly: true } : {}),
    ...(useTools ? { tools: repositoryToolDeclarations() } : {}),
  }

  let reply = await postToGateway(gateway, '/v1/turns', request, logger)

  for (let turn = 1; ; turn++) {
    if (reply.status === 'done') {
      return { content: reply.text, usage: reply.usage }
    }
    if (turn >= MAX_GATEWAY_TURNS) break

    const results: GatewayToolResult[] = []
    for (const call of reply.calls) {
      logger('info', 'Copilot gateway tool call', { tool: call.name })
      let output: string
      try {
        if (!executeToolCallback) throw new Error(`Tool ${call.name} is not available`)
        const result = await executeToolCallback(call.name, call.arguments ?? {})
        output = typeof result === 'string' ? result : JSON.stringify(result)
      } catch (error) {
        output = `Error: ${error instanceof Error ? error.message : String(error)}`
      }
      results.push({ id: call.id, output })
    }

    reply = await postToGateway(
      gateway,
      `/v1/turns/${encodeURIComponent(reply.turnId)}/tool-results`,
      { results },
      logger
    )
  }

  throw new Error('Copilot gateway max iterations reached')
}
