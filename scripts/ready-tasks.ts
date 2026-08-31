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
 * Exits 0 with "READY_EMPTY" when there is nothing queued, so a 15-minute run
 * can stop without parsing anything.
 *
 *   npx tsx scripts/ready-tasks.ts --harness github-copilot
 *   npx tsx scripts/ready-tasks.ts --json --harness github-copilot
 */

// `export {}` makes this a module. Without it the file shares the global
// scope with every other script and `main` collides at typecheck time.
export {}

// .env.local must beat inherited shell exports — a stale ~/.zshrc OAuth export
// is the documented way every script here fails with invalid_client. This was
// the one OAuth script not loading it (surfaced by the sweep's first write).
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

import {
  hasReadyStatus,
  isClaimableByAgent,
  describeAssignee,
  describeSchedule,
  isDueToStart,
  resolveReadyQueueOptions,
  parseBlockedConditions,
  classifyWaitingTask,
  shouldParkScheduledReadyTask,
  type AssignableTask,
  type SchedulableTask,
  type StatusRoleTask,
} from "@/lib/ready-queue-scope"
import { READY_STATUS_ROLE, WAITING_STATUS_ROLE, DOING_STATUS_ROLE } from "@/lib/task-status"
import { serializeReadyTaskQueue } from "./lib/ready-tasks-output"

const BOARD_LIST_NAMES = {
  web: "Astrid Web To-do",
  ios: "Astrid iOS To-do",
} as const

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
const BOARD_LIST_NAME = BOARD_LIST_NAMES[options.board]
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

  // Keep the queue read efficient for scheduled runs: one scoped board request
  // with server-side Ready filtering and lean list payloads.
  // Ready AND Waiting both matter now: the sweep below keeps the two lanes
  // honest (dated work parks in Waiting; met conditions promote back), so the
  // one board read fetches every open task and filters locally.
  const tasksResponse = await fetch(
    `https://astrid.cc/api/v1/tasks?listId=${board.id}&completed=false&leanListMembers=1&limit=${PAGE_LIMIT}`,
    { headers: auth },
  )
  const tasksBody = await tasksResponse.json()
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

  // ── Sweep: keep Ready and Waiting honest (Jon, 2026-08-29) ────────────────
  //
  // Ready must mean "actionable now". A dated Ready task parks in Waiting
  // until its date; a Waiting task whose condition is met comes back. Both
  // moves are logged here and commented on the task, and both touch ONLY
  // tasks this harness may claim — a person's tasks are theirs to move.
  const api = new SweepApi(auth, options.dryRun, report)

  const mine: QueueTask[] = []
  for (const task of claimable) {
    if (shouldParkScheduledReadyTask(task, now)) {
      await api.setStatus(task, WAITING_STATUS_ROLE)
      await api.comment(
        task,
        `📅 Scheduled for ${describeSchedule(task, now)} — parked in Waiting. The loop returns it to Ready when the date arrives.`,
      )
      report(`→ parked "${task.title}" in Waiting [due ${describeSchedule(task, now)}]`)
    } else {
      mine.push(task)
    }
  }

  // Waiting tasks the loop owns: re-check each one's condition this run.
  const held: Array<{ task: QueueTask; when: string }> = []
  const recheck: Array<{ task: QueueTask; condition: string; commentWatermark: string | null }> = []
  const review: Array<{ task: QueueTask; commentWatermark: string | null }> = []
  const blocked: Array<{ task: QueueTask; on: string[] }> = []

  for (const task of waiting.filter(t => isClaimableByAgent(t, options.harness))) {
    const comments = await api.comments(task)
    const conditions = parseBlockedConditions(comments)
    const commentWatermark = latestCommentWatermark(comments)
    let disposition = classifyWaitingTask({
      dueDateTime: task.dueDateTime,
      now,
      blockedBy: conditions.blockedBy,
      blockedOn: conditions.blockedOn,
    })

    if (disposition === 'check-blockers') {
      const open = await api.openBlockers(conditions.blockedBy)
      if (open.length > 0) {
        blocked.push({ task, on: open })
        continue
      }
      // Every blocker is done — reclassify on whatever else holds it.
      disposition = classifyWaitingTask({
        dueDateTime: task.dueDateTime,
        now,
        blockedBy: [],
        blockedOn: conditions.blockedOn,
      })
      if (disposition === 'review') disposition = 'promote'
    }

    if (disposition === 'hold') {
      held.push({ task, when: describeSchedule(task, now) })
    } else if (disposition === 'recheck') {
      recheck.push({ task, condition: conditions.blockedOn ?? '(no condition recorded)', commentWatermark })
    } else if (disposition === 'promote') {
      await api.setStatus(task, READY_STATUS_ROLE)
      await api.comment(task, '⏰ Condition met (date arrived / blockers completed) — back to Ready.')
      report(`→ promoted "${task.title}" to Ready`)
      mine.push(task)
    } else {
      review.push({ task, commentWatermark })
    }
  }

  // Priority high → low, then oldest first — the order /fixall works them in.
  const queue = [...mine].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  if (options.format === 'json') {
    console.log(serializeReadyTaskQueue({
      ready: queue,
      recheck: recheck.map(item => ({ id: item.task.id, commentWatermark: item.commentWatermark })),
      review: review.map(item => ({ id: item.task.id, commentWatermark: item.commentWatermark })),
    }))
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

  // "Doing must be real" too — the loop never moves these (a peer session or
  // a person may be mid-task), but naming them lets a human spot a stale claim.
  if (doing.length > 0) {
    console.log(`(${doing.length} task(s) in Doing — in progress elsewhere; not touched:)`)
    for (const task of doing) {
      console.log(`  — ${task.title}  [${describeAssignee(task)}]`)
    }
  }

  if (held.length > 0) {
    console.log(`(${held.length} Waiting task(s) parked until their date:)`)
    for (const { task, when } of [...held].sort((a, b) => byDueDate(a.task, b.task))) {
      console.log(`  — ${task.title}  [returns ${when}]`)
    }
  }

  if (blocked.length > 0) {
    console.log(`(${blocked.length} Waiting task(s) still blocked by open tasks:)`)
    for (const { task, on } of blocked) {
      console.log(`  — ${task.title}  [blocked by ${on.join(', ')}]`)
    }
  }

  // RECHECK and REVIEW are WORK for the agent, not information: re-verify the
  // stated condition (promote or bump the date), and triage the condition-less.
  if (recheck.length > 0) {
    console.log(`RECHECK (${recheck.length}) — re-verify each condition; if met move to Ready, if not bump the recheck date:`)
    for (const { task, condition } of recheck) {
      console.log(`  ${task.id}  ${task.title}  [waiting on: ${condition}]`)
    }
  }

  if (review.length > 0) {
    console.log(`REVIEW (${review.length}) — Waiting with NO recorded condition; give each a date, a BLOCKED-BY/BLOCKED-ON, or hand it back:`)
    for (const { task } of review) {
      console.log(`  ${task.id}  ${task.title}`)
    }
  }

  if (mine.length === 0) {
    if (recheck.length === 0 && review.length === 0) {
      console.log("READY_EMPTY")
    } else {
      console.log("READY_EMPTY (but RECHECK/REVIEW above need the agent)")
    }
    return
  }

  console.log(`READY (${queue.length}):`)
  for (const task of queue) {
    const stars = "★".repeat(task.priority ?? 0) || "—"
    console.log(`  ${task.id}  ${stars.padEnd(3)}  ${task.title}`)
  }
}

/**
 * The sweep's writes, kept small and loud. Every mutation is a single-field
 * statusRole PUT (never listIds — a full-membership PUT is the strand-a-task
 * bug set-task-status.ts exists to prevent) plus one explanatory comment.
 * --dry-run prints what would move and writes nothing.
 */
class SweepApi {
  constructor(
    private readonly auth: Record<string, string>,
    private readonly dryRun: boolean,
    private readonly report: (...args: unknown[]) => void,
  ) {}

  async setStatus(task: { id: string }, statusRole: string): Promise<void> {
    if (this.dryRun) return
    const response = await fetch(`https://astrid.cc/api/v1/tasks/${task.id}`, {
      method: "PUT",
      headers: { ...this.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ statusRole }),
    })
    if (!response.ok) {
      this.report(`  ⚠️ could not set ${task.id} → ${statusRole}: HTTP ${response.status}`)
    }
  }

  async comment(task: { id: string }, content: string): Promise<void> {
    if (this.dryRun) return
    const response = await fetch(`https://astrid.cc/api/v1/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { ...this.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    if (!response.ok) {
      this.report(`  ⚠️ could not comment on ${task.id}: HTTP ${response.status}`)
    }
  }

  async comments(task: { id: string }): Promise<Array<{
    content?: string | null
    createdAt?: string | null
    updatedAt?: string | null
  }>> {
    const response = await fetch(`https://astrid.cc/api/v1/tasks/${task.id}/comments`, { headers: this.auth })
    if (!response.ok) return []
    const body = await response.json()
    return Array.isArray(body.comments) ? body.comments : []
  }

  /** Which of these blocker ids are still open? Unfetchable ids count as OPEN — promoting on a guess redoes the strand. */
  async openBlockers(ids: string[]): Promise<string[]> {
    const open: string[] = []
    for (const id of ids) {
      const response = await fetch(`https://astrid.cc/api/v1/tasks/${id}`, { headers: this.auth })
      if (!response.ok) {
        open.push(`${id} (unreadable: HTTP ${response.status})`)
        continue
      }
      const body = await response.json()
      if (!body?.task?.completed) open.push(id)
    }
    return open
  }
}

function latestCommentWatermark(
  comments: Array<{ createdAt?: string | null; updatedAt?: string | null }>,
): string | null {
  const timestamps = comments
    .flatMap(comment => [comment.createdAt, comment.updatedAt])
    .filter((value): value is string => !!value && !Number.isNaN(Date.parse(value)))
    .sort()
  return timestamps.at(-1) ?? null
}

/** Soonest first, so the next thing to come due is the first thing listed. */
function byDueDate(a: QueueTask, b: QueueTask) {
  return new Date(a.dueDateTime ?? 0).getTime() - new Date(b.dueDateTime ?? 0).getTime()
}

main().catch(error => {
  console.error("❌ ready-tasks failed:", error)
  process.exit(1)
})
