// Runs POST /api/v1/tasks/:id/claim-fixall through its current response mapping.
// The database and auth boundary are fixed local doubles; no network or data is touched.
// Invoked by scripts/export-contract-fixtures.ts.
//
// Usage: node scripts/contract-fixtures/drivers/fixall-claim.mjs <path-to-astrid-web>

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { state } from './stubs/agent-protocol-state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/fixall-claim.mjs <path-to-astrid-web>')
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
process.env.BRAND_AGENT_EMAIL_DOMAIN = 'astrid.cc'

registerWebAliases(webRoot, {
  '@/lib/prisma': join(here, 'stubs', 'agent-protocol-prisma.mjs'),
  '@/lib/api-auth-wrapper': join(here, 'stubs', 'agent-protocol-with-auth.mjs'),
  '@/lib/api-auth-middleware': join(here, 'stubs', 'agent-protocol-auth.mjs'),
})

const { POST } = await import(pathToFileURL(join(webRoot, 'app/api/v1/tasks/[id]/claim-fixall/route.ts')).href)
const taskId = 'task-claim-fixture'

async function outcome(claimState) {
  state.claim = {
    accessDenied: false,
    forceConflict: false,
    agentAvailable: true,
    task: { statusRole: 'ready', completed: false, dueDateTime: null, comments: [] },
    ...claimState,
  }
  const response = await POST(new Request(`https://astrid.cc/api/v1/tasks/${taskId}/claim-fixall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ready', agent: 'claude', commentWatermark: null }),
  }), { params: Promise.resolve({ id: taskId }) })
  return { status: response.status, body: await response.json() }
}

const outcomes = {
  claimed: await outcome({}),
  conflict: await outcome({ forceConflict: true }),
  notReady: await outcome({ task: { statusRole: 'waiting', completed: false, dueDateTime: null, comments: [] } }),
  forbidden: await outcome({ accessDenied: true }),
}

console.log(JSON.stringify({
  $source: 'scripts/contract-fixtures/drivers/fixall-claim.mjs — POST /api/v1/tasks/:id/claim-fixall',
  outcomes,
}))
