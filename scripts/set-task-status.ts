/**
 * Move a task between task states — Ready, Doing, Waiting.
 *
 *   npx tsx scripts/set-task-status.ts <taskId> Doing
 *   npx tsx scripts/set-task-status.ts <taskId> Waiting
 *
 * Written for the `/fixall` loops, which now say what they are doing on the board:
 * Doing while a task is being worked, Waiting when it is handed back to Jon.
 */

export {}

const API = 'https://astrid.cc'
const STATUS_NAMES = ['Ready', 'Doing', 'Waiting'] as const
type StatusName = (typeof STATUS_NAMES)[number]
const STATUS_ROLE_BY_NAME: Record<Lowercase<StatusName>, string> = {
  ready: 'ready',
  doing: 'doing',
  waiting: 'waiting',
}

async function main() {
  const [taskId, statusArg] = process.argv.slice(2)

  if (!taskId || !statusArg) {
    console.error(`Usage: npx tsx scripts/set-task-status.ts <taskId> <${STATUS_NAMES.join('|')}>`)
    process.exit(1)
  }

  // Case-insensitive in, canonical out.
  const status = STATUS_NAMES.find(
    name => name.toLowerCase() === statusArg.toLowerCase(),
  ) as StatusName | undefined

  if (!status) {
    console.error(`❌ Unknown status "${statusArg}". Expected one of: ${STATUS_NAMES.join(', ')}`)
    process.exit(1)
  }
  const statusRole = STATUS_ROLE_BY_NAME[status.toLowerCase() as Lowercase<StatusName>]

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local')
    process.exit(1)
  }

  const tokenResponse = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!tokenResponse.ok) {
    console.error('❌ Failed to obtain access token:', await tokenResponse.text())
    process.exit(1)
  }
  const { access_token: token } = await tokenResponse.json()
  const auth = { 'X-OAuth-Token': token, 'Content-Type': 'application/json' }

  const before = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const beforeBody = await before.json()
  const task = beforeBody.task ?? beforeBody
  if (!task?.id) {
    console.error('❌ Task not found:', taskId)
    process.exit(1)
  }

  const beforeRole = (task.statusRole ?? '(none)').toString().toLowerCase()
  console.log(`before: statusRole=${beforeRole}`)

  const put = await fetch(`${API}/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ statusRole }),
  })
  if (!put.ok) {
    console.error('❌ Status change failed:', put.status, await put.text())
    process.exit(1)
  }

  // Read back rather than trust the write — a lost board membership is the whole
  // failure mode this script exists to prevent, and it is invisible otherwise.
  const after = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const afterBody = await after.json()
  const afterTask = afterBody.task ?? afterBody
  const afterRole = (afterTask.statusRole ?? '(none)').toString().toLowerCase()
  console.log(`after:  statusRole=${afterRole}`)

  if (afterRole !== statusRole) {
    console.error(`❌ Task statusRole is "${afterRole}" after write, expected "${statusRole}".`)
    process.exit(1)
  }

  const current = task.lists || []
  const afterLists = afterTask.lists || []
  const boardsBefore = current.filter((l: { listType?: string }) => l.listType !== 'status').length
  const boardsAfter = afterLists.filter((l: { listType?: string }) => l.listType !== 'status').length
  if (boardsAfter < boardsBefore) {
    console.error(`❌ Board memberships dropped from ${boardsBefore} to ${boardsAfter} — the task has lost a board.`)
    process.exit(1)
  }

  console.log(`✅ Status → ${status}`)
}

main().catch(error => {
  console.error('❌ set-task-status failed:', error)
  process.exit(1)
})
