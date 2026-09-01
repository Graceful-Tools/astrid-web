export type V1CoverageMode = 'direct' | 'parity' | 'shared-domain'

export interface V1RouteFamilyCoverage {
  mode: V1CoverageMode
  tests: readonly string[]
}

/**
 * Route-family triage table. Every top-level v1 family must be represented;
 * the risk-control script fails when a new family appears without a coverage
 * decision or when one of these representative tests disappears.
 */
export const V1_ROUTE_FAMILY_COVERAGE = {
  agent: { mode: 'direct', tests: ['tests/api/ai-agent-assignment.test.ts'] },
  'agent-icon': { mode: 'direct', tests: ['tests/api/agent-icon.test.ts'] },
  'agent-queue': { mode: 'shared-domain', tests: ['tests/lib/agent-queue.test.ts'] },
  auth: { mode: 'direct', tests: ['tests/api/v1-auth-capability-gate.test.ts'] },
  capabilities: { mode: 'shared-domain', tests: ['tests/lib/capabilities.test.ts'] },
  chat: { mode: 'direct', tests: ['tests/api/v1-chat-message-attachments.test.ts'] },
  comments: { mode: 'direct', tests: ['tests/api/v1-comments-id.test.ts'] },
  contacts: { mode: 'direct', tests: ['tests/api/v1-contacts.test.ts'] },
  'feature-requests': {
    mode: 'shared-domain',
    tests: ['tests/lib/feature-access-requests.test.ts'],
  },
  features: { mode: 'direct', tests: ['tests/api/v1-features.test.ts'] },
  github: {
    mode: 'direct',
    tests: ['tests/api/v1-github-status-multi-integration.test.ts'],
  },
  integrations: {
    mode: 'shared-domain',
    tests: ['tests/lib/sync-providers.test.ts'],
  },
  lists: { mode: 'direct', tests: ['tests/api/v1-lists-id.test.ts'] },
  notifications: { mode: 'shared-domain', tests: ['tests/lib/notifications.test.ts'] },
  oauth: { mode: 'direct', tests: ['tests/api/v1-oauth-clients.test.ts'] },
  openclaw: { mode: 'direct', tests: ['tests/api/v1-openclaw-agents-id.test.ts'] },
  projects: { mode: 'direct', tests: ['tests/api/v1-projects.test.ts'] },
  public: { mode: 'direct', tests: ['tests/api/v1-public-lists-popular-sort.test.ts'] },
  reminders: { mode: 'direct', tests: ['tests/api/v1-users-me-reminder-settings.test.ts'] },
  search: { mode: 'shared-domain', tests: ['tests/lib/search-query-parser.test.ts'] },
  'secure-files': { mode: 'parity', tests: ['tests/api/v1-secure-files-methods.test.ts'] },
  'secure-upload': {
    mode: 'parity',
    tests: ['tests/lib/secure-upload-extension-parity.test.ts'],
  },
  shortcodes: { mode: 'direct', tests: ['tests/api/v1-shortcodes.test.ts'] },
  sse: { mode: 'parity', tests: ['tests/api/mcp-sse-integration.test.ts'] },
  sync: { mode: 'direct', tests: ['tests/api/v1-sync-github-task-links.test.ts'] },
  tasks: { mode: 'direct', tests: ['tests/api/v1-tasks.test.ts'] },
  upload: { mode: 'direct', tests: ['tests/api/zip-file-upload.test.ts'] },
  users: { mode: 'direct', tests: ['tests/api/v1-users-me-settings.test.ts'] },
} as const satisfies Record<string, V1RouteFamilyCoverage>
