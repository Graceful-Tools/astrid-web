/**
 * Integration Registry — Single source of truth for all integration methods.
 * Used by both /llms.txt (machine-readable) and /docs/integrate (human-readable).
 *
 * Brand-bearing strings come from lib/brand/config.ts so a fork rebrands via env.
 */

import { BRAND } from '@/lib/brand/config'
import { CAPABILITIES, type CapabilityKey } from '@/lib/brand/capabilities'

export const ASTRID_DESCRIPTION =
  `${BRAND.appName} is a task management app with native AI agent integration. ` +
  'Families and teams use it for shared lists, and AI agents can be assigned tasks just like people.'

export interface IntegrationMethod {
  id: string
  /**
   * Capability this method depends on. When the deployment has it disabled the method
   * is omitted from /llms.txt and /docs/integrate — advertising an endpoint that
   * answers 404 sends agents and integrators down a dead end. Task 97208a72.
   */
  capability?: CapabilityKey
  name: string
  tagline: string
  description: string
  audience: string
  icon: string // lucide-react icon name
  docsPath?: string
  externalUrl?: string
}

export const INTEGRATION_METHODS: IntegrationMethod[] = [
  {
    id: 'rest-api',
    name: 'REST API',
    tagline: 'CRUD for tasks, lists, and comments',
    description:
      'Full REST API with OAuth2 authentication. Create, read, update, and delete tasks, lists, comments, and members programmatically.',
    audience: 'Backend developers, scripts, automation',
    icon: 'Code2',
    docsPath: '/docs/endpoints',
  },
  {
    id: 'mcp',
    capability: 'integrationMcp',
    name: 'MCP (Model Context Protocol)',
    tagline: 'For Claude Desktop, Cursor, Windsurf, and other MCP clients',
    description:
      `Connect any MCP-compatible AI tool to ${BRAND.appName}. Manage tasks, lists, and comments through the standardized Model Context Protocol.`,
    audience: 'AI tool users (Claude Desktop, Cursor, Windsurf)',
    icon: 'Cpu',
    docsPath: '/docs/mcp',
  },
  {
    id: 'openclaw',
    capability: 'integrationOpenClaw',
    name: 'OpenClaw',
    tagline: 'Build custom AI agents with SSE events',
    description:
      `Open protocol for connecting autonomous AI agents. Your agent gets an @${BRAND.agentEmailDomain} identity, OAuth credentials, and real-time SSE event stream.`,
    audience: 'AI agent developers, custom integrations',
    icon: 'Bot',
    docsPath: '/docs/openclaw',
  },
  {
    id: 'chatgpt',
    capability: 'integrationChatGptActions',
    name: 'ChatGPT Actions',
    tagline: `Power custom GPTs with ${BRAND.appName} data`,
    description:
      `Use ${BRAND.appName}'s OpenAPI spec and OAuth consent screen to create custom GPT actions. Users connect via OAuth to manage tasks from ChatGPT.`,
    audience: 'ChatGPT users, GPT builders',
    icon: 'MessageSquare',
    docsPath: '/docs',
  },
  {
    id: 'sdk',
    name: `${BRAND.appName} SDK`,
    tagline: 'Run AI coding agents locally or in the cloud',
    description:
      'npm package for running Claude, OpenAI, or Gemini coding agents. Supports terminal mode (local CLI), API mode (cloud), and webhook mode (servers).',
    audience: 'Developers running AI coding agents',
    icon: 'Terminal',
    externalUrl: 'https://www.npmjs.com/package/@gracefultools/astrid-sdk',
  },
]

const ALL_WELL_KNOWN_ENDPOINTS = [
  { path: '/.well-known/ai-plugin.json', description: 'ChatGPT plugin manifest', capability: 'integrationChatGptActions' },
  { path: '/.well-known/astrid-openapi.yaml', description: 'OpenAPI 3.0 specification', capability: 'integrationChatGptActions' },
  { path: '/llms.txt', description: 'LLM-readable integration guide' },
  { path: '/api/mcp/context', description: 'MCP capabilities and operations', capability: 'integrationMcp' },
] as const satisfies ReadonlyArray<{ path: string; description: string; capability?: CapabilityKey }>

/** Only what this deployment actually serves. */
export const WELL_KNOWN_ENDPOINTS = ALL_WELL_KNOWN_ENDPOINTS.filter(
  (endpoint) => !('capability' in endpoint) || CAPABILITIES[endpoint.capability as CapabilityKey]
)

/** Integration methods this deployment actually offers. */
export function enabledIntegrationMethods(): IntegrationMethod[] {
  return INTEGRATION_METHODS.filter((m) => !m.capability || CAPABILITIES[m.capability])
}
