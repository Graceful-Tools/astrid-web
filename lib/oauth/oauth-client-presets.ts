import { agentEmail } from '@/lib/brand/agent-emails'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

export const OAUTH_REDIRECT_PRESETS = {
  vscodeCopilot: [
    'http://127.0.0.1:33418',
    'https://vscode.dev/redirect',
  ],
} as const

export function mergeOAuthRedirectUris(currentValue: string, preset: readonly string[]): string {
  const currentUris = currentValue
    .split('\n')
    .map(uri => uri.trim())
    .filter(Boolean)

  return [...new Set([...currentUris, ...preset])].join('\n')
}

/**
 * The client shapes the agents page mints for its own transports.
 *
 * A GitHub Actions queue gate and a self-hosted webhook server both need a
 * client_credentials pair and nothing else — no redirect URI, no grant-type
 * decision, no scope matrix. Those questions are what the developer console
 * asks, which is why "create credentials in API Access" was a detour the
 * reader had no way to answer well. A preset answers them here, once, and
 * follows the `ai_agent` group so a scope added to the group reaches every
 * client minted this way (task 9ebfaba7).
 */
export type OAuthClientPreset = 'githubActions' | 'webhookServer'

export interface OAuthClientPresetParams {
  name: string
  description: string
  grantTypes: string[]
  scopes: string[]
  scopeGroup: 'ai_agent'
}

const PRESET_LABELS: Record<OAuthClientPreset, string> = {
  githubActions: 'GitHub Actions',
  webhookServer: 'Webhook server',
}

export function isOAuthClientPreset(value: unknown): value is OAuthClientPreset {
  return typeof value === 'string' && value in PRESET_LABELS
}

export function oauthClientPreset(preset: OAuthClientPreset, agentMailbox: string): OAuthClientPresetParams {
  return {
    name: `${PRESET_LABELS[preset]} · ${agentEmail(agentMailbox)}`,
    description: `Minted from Settings → AI Agents for the ${agentMailbox} ${PRESET_LABELS[preset].toLowerCase()}`,
    grantTypes: ['client_credentials'],
    scopes: [...SCOPE_GROUPS.ai_agent],
    scopeGroup: 'ai_agent',
  }
}
