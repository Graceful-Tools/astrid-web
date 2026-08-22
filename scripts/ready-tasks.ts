/**
 * Print the tasks a `/fixall` loop may work: on its board, in the **Ready**
 * status, assigned to this harness.
 *
 * The loop previously had to call `get-astrid-tasks` and then one `analyze-task`
 * PER TASK just to read list membership, which the list script does not print —
 * six requests to discover that there is nothing to do. `GET /api/v1/tasks?listId=`
 * filters server-side, so the whole check is one call.
 *
 * Takes a board plus an explicit harness identity:
 * `ready-tasks.ts [web|ios] --harness <selector>`. The board defaults to web;
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
 * Exits 0 with "READY_EMPTY" when there is nothing queued, so a scheduled run
 * can stop without parsing anything.
 *
 *   npx tsx scripts/ready-tasks.ts --harness github-copilot
 */

// `export {}` makes this a module. Without it the file shares the global
// scope with every other script and `main` collides at typecheck time.
export {}

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

const BOARD_LIST_NAMES = {
  web: "Astrid Web To-do",
  ios: "Astrid iOS To-do",
} as const

/** One page is the whole point of this script; say so rather than truncate quietly. */
const PAGE_LIMIT = 1000

/**
 * Which board to scope to. Both loops use this script so that the guarantees
 * are the same for each — the board, the Ready status field, the exact harness
 * assignee, loud failure on a missing board, and a printed reason for everything
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
const BOARD_LIST_NAME = BOARD_LIST_NAMES[options.board]

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
  const listsBody = await listsResponse.json()
  const lists = listsBody.lists ?? listsBody
  const board = (Array.isArray(lists) ? lists : []).find(
    (list: { name?: string }) => list.name === BOARD_LIST_NAME,
  )

  // Fail loudly on a missing board instead of degrading to an empty queue —
  // skipping the filter would silently widen the loop to every board on the
  // account, and returning nothing would look like an idle day.
  if (!board) {
    console.error(`❌ No list named "${BOARD_LIST_NAME}" found — refusing to run unscoped.`)
    process.exit(1)
  }

  const tasksResponse = await fetch(
    `https://astrid.cc/api/v1/tasks?listId=${board.id}&completed=false&limit=${PAGE_LIMIT}`,
    { headers: auth },
  )
  const tasksBody = await tasksResponse.json()
  const tasks = tasksBody.tasks ?? tasksBody
  const all: QueueTask[] = Array.isArray(tasks) ? tasks : []

  // A truncated page would hide queued work behind an untriaged backlog, and the
  // loop would report a clean run. Say it rather than quietly working a subset.
  const total = tasksBody?.meta?.total
  if (typeof total === "number" && total > all.length) {
    console.log(`(⚠️  board has ${total} open tasks; only the first ${all.length} were read)`)
  }

  // Ready is a STATE on the task. Everything else on the board is filed but not
  // triaged — the backlog is the normal case here, so it is counted, not listed.
  const ready = all.filter(hasReadyStatus)
  const notReady = all.length - ready.length

  // ...and assigned to this exact harness identity.
  //
  // An assignee is a claim. A task assigned to a person is that person's, even
  // when it is Ready — the loop picking it up means two people writing the same
  // fix, or Jon's own in-progress work being redone underneath him. Ready says
  // "this is actionable", not "this is unclaimed", so the two conditions are
  // separate and both are required.
  const claimable = ready.filter(task => isClaimableByAgent(task, options.harness))
  const claimed = ready.filter(task => !isClaimableByAgent(task, options.harness))

  // ...and not scheduled for later. A task with a date is not work for today, and a REPEATING
  // task rolls forward to its next occurrence when it is completed — so a recurring chore
  // leaves the queue on completion and returns by itself when it comes due, tracked in Astrid
  // rather than in a cron file nobody can see (Jon, 2026-08-19).
  const now = new Date()
  const mine = claimable.filter(task => isDueToStart(task, now))
  const scheduled = claimable.filter(task => !isDueToStart(task, now))

  if (notReady > 0) {
    console.log(`(${notReady} open task(s) on ${BOARD_LIST_NAME} without the Ready status — not queued)`)
  }

  // A queue held up by work the loop may not take must not look like an idle one.
  // Naming the assignee is what lets Jon see whether it is waiting on a person or
  // simply waiting to be handed something.
  //
  // The wording covers BOTH reasons. Since assignment became the handshake,
  // "unassigned" is the common case, and calling that "assigned to someone else"
  // was plainly wrong — it read as a claim by a person who did not exist.
  if (claimed.length > 0) {
    const unassigned = claimed.filter(task => !task.assigneeId).length
    const reason =
      unassigned === claimed.length ? 'not assigned to this loop'
      : unassigned === 0 ? 'assigned to someone else'
      : `${unassigned} unassigned, ${claimed.length - unassigned} assigned to someone else`
    console.log(`(${claimed.length} Ready task(s) — ${reason}:)`)
    for (const task of claimed) {
      const who = describeAssignee(task)
      console.log(`  — ${task.title}  [${who}]`)
    }
  }

  // A queue waiting on the clock must not look like an idle one either — say WHEN, so a
  // recurring task that is simply not due yet is visibly different from one nobody has queued.
  if (scheduled.length > 0) {
    console.log(`(${scheduled.length} Ready task(s) scheduled for later — not yet due:)`)
    for (const task of [...scheduled].sort(byDueDate)) {
      console.log(`  — ${task.title}  [due ${describeSchedule(task, now)}]`)
    }
  }

  if (mine.length === 0) {
    console.log("READY_EMPTY")
    return
  }

  // Priority high → low, then oldest first — the order /fixall works them in.
  const queue = [...mine].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

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
