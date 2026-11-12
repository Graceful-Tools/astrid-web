/**
 * Print the tasks a `/fixall` loop may work: on its board, in the **Ready**
 * status, and either unassigned or assigned to this harness.
 *
 * The loop previously had to call `get-astrid-tasks` and then one `analyze-task`
 * PER TASK just to read list membership, which the list script does not print —
 * six requests to discover that there is nothing to do. `GET /api/v1/tasks?listId=`
 * filters server-side, so the whole check is one call.
 *
 * Takes a board plus an explicit harness identity:
 * `ready-tasks.ts [web|ios|windows|android] --harness <selector>`. The board defaults to web;
 * the harness has no default because guessing could claim another agent's work.
 *
 * READY IS A FIELD ON THE TASK, not a list it is attached to. Status used to be
 * membership in an account-wide `listType: 'status'` list; AWTD-562 moved it to
 * `Task.statusRole` because the list model could not be per-user and shared at
 * once. Reading the old lists left the queue a shadow of the real state — a task
 * Jon marked Ready in the app (which writes only the field) never showed up, and
 * a task still carrying a legacy `Ready` membership stayed queued after it had
 * moved on. So: fetch the BOARD, filter on the field.
 *
 * Scoping to the board is still required, and is now what the single query does.
 * `Ready` is one status shared by every board on the account — Astrid iOS To-do,
 * Voteelo, Career, all of them — so filtering on the status alone would queue
 * whatever Jon marked ready anywhere, and the web loop would pick up iOS work a
 * second agent is already running against `astrid-ios`.
 *
 * Exits 0 with "READY_EMPTY" when there is nothing queued, so a 15-minute run
 * can stop without parsing anything.
 *
 * READ-ONLY. This used to sweep the lanes too — park dated Ready work in Waiting,
 * promote met Waiting conditions, surface RECHECK/REVIEW. That is the server's
 * job now: the Waiting rules are astrid-core's, and the server's settle job runs
 * them for every board. This script only reads, and is for debugging the queue;
 * a loop reads its work from `get_agent_queue`. `--dry-run` is accepted and
 * changes nothing, for callers that still pass it.
 *
 *   npx tsx scripts/ready-tasks.ts --harness github-copilot
 *   npx tsx scripts/ready-tasks.ts --json --harness github-copilot
 */

// `export {}` makes this a module. Without it the file shares the global
// scope with every other script and `main` collides at typecheck time.
export {}

// .env.local must beat inherited shell exports — a stale ~/.zshrc OAuth export
// is the documented way every script here fails with invalid_client. This was
// the one OAuth script not loading it (surfaced by its first write, when it still wrote).
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

import {
  hasReadyStatus,
  isClaimableByAgent,
  describeAssignee,
  describeSchedule,
  isDueToStart,
  resolveReadyQueueOptions,
  type AssignableTask,
  type SchedulableTask,
  type StatusRoleTask,
} from "@/lib/ready-queue-scope"
import { WAITING_STATUS_ROLE, DOING_STATUS_ROLE } from "@/lib/task-status"
import { serializeReadyTaskQueue } from "./lib/ready-tasks-output"
import { boardTasksUrl } from './lib/board-read-url'
import { findBoardList } from './lib/board-by-name'

/** One page is the whole point of this script; say so rather than truncate quietly. */
const PAGE_LIMIT = 1000

/**
 * Which board to scope to. Both loops use this script so that the guarantees
 * are the same for each — the board, the Ready status field, the exact harness
 * assignee/unassigned scope, loud failure on a missing board, and a printed
 * reason for everything
 * skipped. A second copy of this for iOS would drift, and the drift would be
 * silent: a queue that is wrong in this script looks exactly like a quiet day.
 *
 *   npx tsx scripts/ready-tasks.ts --harness claude-code
 *   npx tsx scripts/ready-tasks.ts ios --harness codex
 */
function loadOptions() {
  try {
    return resolveReadyQueueOptions(process.argv.slice(2), process.env)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
const options = loadOptions()
const report = options.format === 'json' ? console.error : console.log

type QueueTask = AssignableTask & StatusRoleTask & SchedulableTask & {
  id: string
  title: string
  priority?: number
  createdAt: string
}

async function main() {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error("❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local")
    process.exit(1)
  }

  const tokenResponse = await fetch("https://astrid.cc/api/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!tokenResponse.ok) {
    console.error("❌ Failed to obtain access token:", await tokenResponse.text())
    process.exit(1)
  }

  const { access_token: token } = await tokenResponse.json()
  const auth = { "X-OAuth-Token": token }

  // Resolve the board by NAME rather than hardcoding its id: an id is account
  // data, and a hardcoded one fails silently by returning an empty list, which
  // reads exactly like "nothing to do".
  const listsResponse = await fetch("https://astrid.cc/api/v1/lists", { headers: auth })
  if (!listsResponse.ok) throw new Error(`Board lookup failed: HTTP ${listsResponse.status}`)
  const listsBody = await listsResponse.json()
  // Fail loudly on a missing board instead of degrading to an empty queue —
  // skipping the filter would silently widen the loop to every board on the
  // account, and returning nothing would look like an idle day.
  let board: { id: string }
  try {
    if (options.listId) {
      const lists = Array.isArray(listsBody) ? listsBody : listsBody.lists
      const match = lists?.find((list: { id: string }) => list.id === options.listId)
      if (!match) throw new Error('Explicit board list is not accessible')
      board = match
    } else {
      board = findBoardList(listsBody, options.board)
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }

  // One board read of every open task, filtered locally, so the debug output can
  // name what sits in Doing and Waiting as well as what queues. It leaves the
  // descriptions on the server (AWTD-1237): this reads id, title, priority,
  // statusRole, dueDateTime, assignee and completed, and nothing else.
  const tasksResponse = await fetch(
    boardTasksUrl({ boardId: board.id, limit: PAGE_LIMIT }),
    { headers: auth },
  )
  const tasksBody = await tasksResponse.json()
  if (!tasksResponse.ok) throw new Error(`Board read failed: HTTP ${tasksResponse.status}`)
  const tasks = tasksBody.tasks ?? tasksBody
  const all: QueueTask[] = Array.isArray(tasks) ? tasks : []

  // A truncated page would hide queued work behind an untriaged backlog, and the
  // loop would report a clean run. Say it rather than quietly working a subset.
  const total = tasksBody?.meta?.total
  if (typeof total === "number" && total > all.length) {
    report(`(⚠️  board has ${total} open tasks; only the first ${all.length} were read)`)
  }

  const now = new Date()
  const role = (task: QueueTask) => (task.statusRole ?? '').trim().toLowerCase()
  const ready = all.filter(hasReadyStatus)
  const waiting = all.filter(task => !task.completed && role(task) === WAITING_STATUS_ROLE)
  const doing = all.filter(task => !task.completed && role(task) === DOING_STATUS_ROLE)

  // ...and either unassigned or assigned to this exact harness identity.
  //
  // A task assigned to a person is still that person's claim; the unassigned
  // case is intentionally claimable for this loop per current workflow policy.
  const claimable = ready.filter(task => isClaimableByAgent(task, options.harness))
  const claimed = ready.filter(task => !isClaimableByAgent(task, options.harness))

  // Due now, or held for its date. A dated Ready task is not this script's to
  // move: the server's settle job parks it in Waiting (astrid-core R5).
  const mine = claimable.filter(task => isDueToStart(task, now))
  const notDue = claimable.filter(task => !isDueToStart(task, now))

  // Priority high → low, then oldest first — the order /fixall works them in.
  const queue = [...mine].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  if (options.format === 'json') {
    console.log(serializeReadyTaskQueue({ ready: queue }))
    return
  }

  // A queue held up by work the loop may not take must not look like an idle one.
  // Naming the assignee is what lets Jon see whether it is waiting on a person or
  // simply waiting to be handed something.
  if (claimed.length > 0) {
    console.log(`(${claimed.length} Ready task(s) assigned to someone else:)`)
    for (const task of claimed) {
      console.log(`  — ${task.title}  [${describeAssignee(task)}]`)
    }
  }

  // The loop never moves these (a peer session or a person may be mid-task, and
  // finished work awaiting its deploy waits here), but naming them lets a human
  // spot a stale claim.
  if (doing.length > 0) {
    console.log(`(${doing.length} task(s) in Doing — in progress elsewhere; not touched:)`)
    for (const task of doing) {
      console.log(`  — ${task.title}  [${describeAssignee(task)}]`)
    }
  }

  if (notDue.length > 0) {
    console.log(`(${notDue.length} Ready task(s) not due yet — the server's settle job parks them in Waiting until their date:)`)
    for (const task of [...notDue].sort(byDueDate)) {
      console.log(`  — ${task.title}  [due ${describeSchedule(task, now)}]`)
    }
  }

  // Waiting is settled server-side (a date or a blocking task wakes it); listed
  // so a human can see what is parked, never acted on here.
  if (waiting.length > 0) {
    console.log(`(${waiting.length} task(s) in Waiting — the server wakes each when its date arrives or its blockers finish:)`)
    for (const task of [...waiting].sort(byDueDate)) {
      const when = describeSchedule(task, now)
      console.log(`  — ${task.title}  [${when ? `until ${when}` : 'on a blocking task'}; ${describeAssignee(task)}]`)
    }
  }

  if (queue.length === 0) {
    console.log("READY_EMPTY")
    return
  }

  console.log(`READY (${queue.length}):`)
  for (const task of queue) {
    const stars = "★".repeat(task.priority ?? 0) || "—"
    console.log(`  ${task.id}  ${stars.padEnd(3)}  ${task.title}`)
  }
}

/** Soonest first, so the next thing to come due is the first thing listed. */
function byDueDate(a: QueueTask, b: QueueTask) {
  return new Date(a.dueDateTime ?? 0).getTime() - new Date(b.dueDateTime ?? 0).getTime()
}

main().catch(error => {
  console.error("❌ ready-tasks failed:", error)
  process.exit(1)
})
