/**
 * Integration Registry — Single source of truth for all Astrid integration methods.
 * Used by both /llms.txt (machine-readable) and /docs/integrate (human-readable).
 */

export const ASTRID_DESCRIPTION =
  'Astrid is a task management app with native AI agent integration. ' +
  'Families and teams use it for shared lists, and AI agents can be assigned tasks just like people.'

export interface IntegrationMethod {
  id: string
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
    name: 'MCP (Model Context Protocol)',
    tagline: 'For Claude Desktop, Cursor, Windsurf, and other MCP clients',
    description:
      'Connect any MCP-compatible AI tool to Astrid. Manage tasks, lists, and comments through the standardized Model Context Protocol.',
    audience: 'AI tool users (Claude Desktop, Cursor, Windsurf)',
    icon: 'Cpu',
    docsPath: '/docs/mcp',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    tagline: 'Build custom AI agents with SSE events',
    description:
      'Open protocol for connecting autonomous AI agents. Your agent gets an @astrid.cc identity, OAuth credentials, and real-time SSE event stream.',
    audience: 'AI agent developers, custom integrations',
    icon: 'Bot',
    docsPath: '/docs/openclaw',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT Actions',
    tagline: 'Power custom GPTs with Astrid data',
    description:
      'Use Astrid\'s OpenAPI spec and OAuth consent screen to create custom GPT actions. Users connect via OAuth to manage tasks from ChatGPT.',
    audience: 'ChatGPT users, GPT builders',
    icon: 'MessageSquare',
    docsPath: '/docs',
  },
  {
    id: 'sdk',
    name: 'Astrid SDK',
    tagline: 'Run AI coding agents locally or in the cloud',
    description:
      'npm package for running Claude, OpenAI, or Gemini coding agents. Supports terminal mode (local CLI), API mode (cloud), and webhook mode (servers).',
    audience: 'Developers running AI coding agents',
    icon: 'Terminal',
    externalUrl: 'https://www.npmjs.com/package/@gracefultools/astrid-sdk',
  },
]

export const WELL_KNOWN_ENDPOINTS = [
  { path: '/.well-known/ai-plugin.json', description: 'ChatGPT plugin manifest' },
  { path: '/.well-known/astrid-openapi.yaml', description: 'OpenAPI 3.0 specification' },
  { path: '/llms.txt', description: 'LLM-readable integration guide' },
  { path: '/api/mcp/context', description: 'MCP capabilities and operations' },
] as const
