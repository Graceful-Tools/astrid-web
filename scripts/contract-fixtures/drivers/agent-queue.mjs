// Runs GET /api/v1/agent-queue over fixed database rows, including an unanswered human
// comment and scheduled work. Invoked by scripts/export-contract-fixtures.ts.
//
// Usage: node scripts/contract-fixtures/drivers/agent-queue.mjs <path-to-astrid-web>

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { state } from './stubs/agent-protocol-state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/agent-queue.mjs <path-to-astrid-web>')
  process.exit(2)
}

const FIXED_NOW = Date.parse('2026-01-15T09:00:00.000Z')
const NativeDate = globalThis.Date
class FixedDate extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [FIXED_NOW] : args))
  }
  static now() {
    return FIXED_NOW
  }
}
globalThis.Date = FixedDate
process.env.NEXTAUTH_URL = 'https://astrid.cc'
process.env.BRAND_AGENT_EMAIL_DOMAIN = 'astrid.cc'
process.env.ASTRID_AGENT_EXECUTION_MODE_SHADOW = 'false'

registerWebAliases(webRoot, {
  '@/lib/prisma': join(here, 'stubs', 'agent-protocol-prisma.mjs'),
  '@/lib/api-auth-wrapper': join(here, 'stubs', 'agent-protocol-with-auth.mjs'),
  '@/lib/oauth/oauth-token-manager': join(here, 'stubs', 'unused-shadow-token.mjs'),
})

const { GET } = await import(pathToFileURL(join(webRoot, 'app/api/v1/agent-queue/route.ts')).href)
const start = new Date(FIXED_NOW)
const later = new Date(FIXED_NOW + 90 * 60_000)
const list = { id: 'list-web', name: 'Astrid Web To-do', githubRepositoryId: null }

const readyTask = {
  id: 'task-ready',
  identifier: 'AWTD-9001',
  title: 'Update the agent guide',
  description: 'Refresh the queue setup examples.',
  priority: 2,
  dueDateTime: null,
  isAllDay: false,
  createdAt: start,
  assigneeId: 'agent-claude',
  lists: [list],
}
const scheduledTask = {
  ...readyTask,
  id: 'task-scheduled',
  identifier: 'AWTD-9002',
  title: 'Review the next release',
  dueDateTime: later,
}
const attentionTask = {
  id: 'task-attention',
  identifier: 'AWTD-9003',
  title: 'Check the deployment note',
  statusRole: 'doing',
  completed: false,
  completedAt: null,
  comments: [{
    id: 'comment-human',
    content: 'Could you check this before the next run?',
    authorId: 'user-human',
    author: { id: 'user-human', name: 'Team member', isAIAgent: false },
    createdAt: new Date(FIXED_NOW - 5 * 60_000),
    updatedAt: new Date(FIXED_NOW - 5 * 60_000),
  }],
}

async function queue(tasks, attention = [], notReadyCount = 0) {
  state.mcpSettings = null
  state.queue = { tasks, attention, notReadyCount }
  const response = await GET(new Request('https://astrid.cc/api/v1/agent-queue?agent=claude'))
  return response.json()
}

const scenarios = {
  available: await queue([readyTask, scheduledTask], [attentionTask]),
  scheduled: await queue([scheduledTask]),
  notReady: await queue([], [], 3),
}

console.log(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/agent-queue.mjs — GET /api/v1/agent-queue with fixed rows',
  clock: new NativeDate(FIXED_NOW).toISOString(),
  scenarios,
}))
