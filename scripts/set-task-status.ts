/**
 * Move a task between the status lists — Ready, Doing, Waiting.
 *
 *   npx tsx scripts/set-task-status.ts <taskId> Doing
 *   npx tsx scripts/set-task-status.ts <taskId> Waiting
 *
 * Written for the `/fixall` loops, which now say what they are doing on the board:
 * Doing while a task is being worked, Waiting when it is handed back to Jon.
 *
 * NOT `move-task-to-list.ts`. That one sends `listIds: [target]`, which is correct
 * for moving a task from one BOARD to another and destructive here — status is a
 * second membership alongside the board, and `PUT` replaces the whole set, so the
 * obvious write lands the task on Doing and takes it off Astrid iOS To-do, out of
 * every queue, findable only by id.
 *
 * The membership arithmetic is in `lib/task-status-lists.ts` with tests. This file
 * is the transport plus the guards that need a live task to check.
 */

export {}

import {
  listIdsForStatusChange,
  unsafeStatusChangeReason,
  STATUS_LIST_NAMES,
  type StatusListName,
} from '@/lib/task-status-lists'

const API = 'https://astrid.cc'

async function main() {
  const [taskId, statusArg] = process.argv.slice(2)

  if (!taskId || !statusArg) {
    console.error(`Usage: npx tsx scripts/set-task-status.ts <taskId> <${STATUS_LIST_NAMES.join('|')}>`)
    process.exit(1)
  }

  // Case-insensitive in, canonical out — the list is matched by exact name below.
  const status = STATUS_LIST_NAMES.find(
    name => name.toLowerCase() === statusArg.toLowerCase(),
  ) as StatusListName | undefined

  if (!status) {
    console.error(`❌ Unknown status "${statusArg}". Expected one of: ${STATUS_LIST_NAMES.join(', ')}`)
    process.exit(1)
  }

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

  // Resolve the status list by name AND type. Several accounts have a personal
  // list called "Waiting"; picking one of those would file the task somewhere
  // nobody is looking.
  const listsResponse = await fetch(`${API}/api/v1/lists`, { headers: auth })
  const listsBody = await listsResponse.json()
  const lists: Array<{ id: string; name?: string; listType?: string }> =
    listsBody.lists ?? (Array.isArray(listsBody) ? listsBody : [])

  const statusLists = lists.filter(l => l.listType === 'status' && l.name === status)
  if (statusLists.length === 0) {
    console.error(`❌ No status list named "${status}". Nothing written.`)
    console.error('   Status lists visible:', lists.filter(l => l.listType === 'status').map(l => l.name).join(' | ') || '(none)')
    process.exit(1)
  }
  if (statusLists.length > 1) {
    console.error(`❌ ${statusLists.length} status lists named "${status}" — refusing to guess which.`)
    process.exit(1)
  }
  const target = statusLists[0]

  const before = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const beforeBody = await before.json()
  // `GET /api/v1/tasks/[id]` returns `{ task, meta }` — reading `body.lists`
  // yields undefined, and an undefined filtered to [] is how a task loses every
  // membership at once.
  const task = beforeBody.task ?? beforeBody
  if (!task?.id) {
    console.error('❌ Task not found:', taskId)
    process.exit(1)
  }

  const current = task.lists || []
  console.log('before:', JSON.stringify(current.map((l: { name?: string }) => l.name)))

  const unsafe = unsafeStatusChangeReason(current, target.id)
  if (unsafe) {
    console.error(`❌ Refusing to write: ${unsafe}`)
    process.exit(1)
  }

  const listIds = listIdsForStatusChange(current, target.id)

  const put = await fetch(`${API}/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ listIds }),
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
  const names: string[] = (afterTask.lists || []).map((l: { name?: string }) => l.name)
  console.log('after: ', JSON.stringify(names))

  if (!names.includes(status)) {
    console.error(`❌ Task is NOT on "${status}" after the write — check it by hand.`)
    process.exit(1)
  }

  const boardsBefore = current.filter((l: { listType?: string }) => l.listType !== 'status').length
  const boardsAfter = (afterTask.lists || []).filter((l: { listType?: string }) => l.listType !== 'status').length
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
