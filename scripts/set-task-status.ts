/**
 * Set a task's board status — Ready, Doing, Waiting.
 *
 *   npx tsx scripts/set-task-status.ts <taskId> Doing
 *   npx tsx scripts/set-task-status.ts <taskId> Waiting --until 2026-12-01T09:00:00Z
 *   npx tsx scripts/set-task-status.ts <taskId> Waiting --blocked-by AWTD-1234 [--keep-assignee]
 *
 * Written for the `/fixall` loops, which say what they are doing on the board.
 * Waiting is only for a task waiting on a DATE or another TASK, and the
 * condition goes in the same write (scripts/lib/task-status-args.ts; the rule is
 * astrid-core's and the server enforces it). Waiting on a PERSON is a handback:
 * `assign-task.ts <taskId> <email> --handback`.
 *
 * STATUS IS A FIELD ON THE TASK (`statusRole`), not a list the task is attached
 * to. It was membership in a `listType: 'status'` list until AWTD-562, which
 * moved it because the list model could not be per-user (or every picker filled
 * with duplicate Ready/Doing/Waiting sets) and shared (or two members of one
 * board resolved different columns) at the same time.
 *
 * Writing the field is also what the queue reads, so a status written only as
 * list membership would leave the task Ready as far as the queue is concerned —
 * the loop would move a task to Doing, then pick it up again on the next run.
 *
 * Because this no longer touches `listIds`, the destructive failure the previous
 * version guarded against — `PUT` replacing the whole membership set, dropping
 * the task off its board and out of every queue — is now impossible by
 * construction rather than avoided by arithmetic. The read-back below still
 * proves the board memberships survived, since that is the failure nobody would
 * otherwise see.
 */

export {}

import { loadScriptEnv } from './lib/load-env'
import { agentSignature } from './lib/agent-author'
import { parseSetTaskStatusArgs, type SetTaskStatusArgs } from './lib/task-status-args'
import { WAITING_STATUS_ROLE } from '@/lib/task-status'

loadScriptEnv()

const API = 'https://astrid.cc'

async function main() {
  let args: SetTaskStatusArgs
  try {
    args = parseSetTaskStatusArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
  const { taskId } = args
  const status = { role: args.role, name: args.name }

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
  // `GET /api/v1/tasks/[id]` returns `{ task, meta }`. Reading the fields off
  // the envelope yields undefined, which is how a guard silently stops guarding.
  const task = beforeBody.task ?? beforeBody
  if (!task?.id) {
    console.error('❌ Task not found:', taskId)
    process.exit(1)
  }

  // Done carries no status — the server nulls the field on completion, so this
  // write would appear to succeed and change nothing.
  if (task.completed) {
    console.error(`❌ Task is completed; Done carries no status. Reopen it first if the status matters.`)
    process.exit(1)
  }

  const boardsBefore: string[] = (task.lists || [])
    .filter((l: { listType?: string }) => l.listType !== 'status')
    .map((l: { name?: string; id: string }) => l.name || l.id)
  console.log('before:', JSON.stringify({ status: task.statusRole ?? null, boards: boardsBefore }))

  // Say WHO is moving this (AWTD-974). The status change emits a system
  // activity line, and client-credentials auth resolves to the OAuth client's
  // owner — so without this the board reads "Jon Paris moved this to Waiting"
  // for a move the loop made.
  //
  // It read `ASTRID_AGENT_ID || CLAUDE_AGENT_ID` until AWTD-1311, which is the
  // bug one layer along rather than fixed: `.env.local` sets CLAUDE_AGENT_ID on
  // every machine that runs the Claude loop, and this script is run by Copilot
  // and Codex too — so a Copilot handback was recorded as CLAUDE moving the
  // task. `--agent <mailbox>` resolves per mailbox, like every other writer.
  const signature = await agentSignature(token)

  const put = await fetch(`${API}/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: auth,
    // The move and its wait condition in ONE write: the server decides Waiting
    // against both, and refuses a condition-less move (WAITING_NEEDS_CONDITION).
    body: JSON.stringify({ ...args.body, ...signature }),
  })
  if (!put.ok) {
    console.error('❌ Status change failed:', put.status, await put.text())
    process.exit(1)
  }

  // Read back rather than trust the write. The status is what the next loop run
  // reads to decide whether this task is still queued, so a write that quietly
  // did nothing would put the loop straight back on the same task.
  const after = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const afterBody = await after.json()
  const afterTask = afterBody.task ?? afterBody
  const boardsAfter: string[] = (afterTask.lists || [])
    .filter((l: { listType?: string }) => l.listType !== 'status')
    .map((l: { name?: string; id: string }) => l.name || l.id)
  console.log('after: ', JSON.stringify({
    status: afterTask.statusRole ?? null, boards: boardsAfter,
    ...(args.body.dueDateTime ? { dueDateTime: afterTask.dueDateTime ?? null } : {}),
    ...(status.role === WAITING_STATUS_ROLE ? { assigneeId: afterTask.assigneeId ?? null } : {}),
  }))

  if (afterTask.statusRole !== status.role) {
    console.error(`❌ Status is "${afterTask.statusRole ?? 'none'}" after the write, not "${status.role}" — check it by hand.`)
    process.exit(1)
  }

  if (boardsAfter.length < boardsBefore.length) {
    console.error(`❌ Board memberships dropped from ${boardsBefore.length} to ${boardsAfter.length} — the task has lost a board.`)
    process.exit(1)
  }

  console.log(`✅ Status → ${status.name}`)
}

main().catch(error => {
  console.error('❌ set-task-status failed:', error)
  process.exit(1)
})
