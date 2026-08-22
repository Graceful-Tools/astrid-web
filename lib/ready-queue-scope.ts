/**
 * Which Ready tasks an autonomous loop may take.
 *
 * `Ready` means "this is actionable". It does not mean "this is unclaimed", and
 * the two came apart the moment tasks started being assigned: a loop that works
 * everything in Ready will redo work a person is already doing, or write a
 * second fix for something Jon has half-finished.
 *
 * So the queue needs both conditions — on this board with the Ready STATUS, AND
 * either unassigned or explicitly handed to this exact harness identity. This
 * module owns both predicates.
 *
 * Lives in lib/ rather than inside scripts/ready-tasks.ts because that script
 * calls main() at import, so the rules could not otherwise be tested without
 * firing a network request.
 */

import {
  AGENT_MAILBOXES,
  agentEmail,
  type AgentMailbox,
} from '@/lib/brand/agent-emails'
// The role lives with the states it belongs to. A second copy here would drift
// silently: a wrong role matches nothing and reads as an empty queue.
import { READY_STATUS_ROLE } from '@/lib/task-status'

export const FIXALL_HARNESS_MAILBOXES = {
  'claude-code': AGENT_MAILBOXES.claude,
  'github-copilot': AGENT_MAILBOXES.copilot,
  codex: AGENT_MAILBOXES.codex,
  'astrid-server': AGENT_MAILBOXES.astrid,
} as const satisfies Record<string, AgentMailbox>

export type FixallHarness = keyof typeof FIXALL_HARNESS_MAILBOXES
export type ReadyQueueBoard = 'web' | 'ios'

const READY_QUEUE_BOARDS: readonly ReadyQueueBoard[] = ['web', 'ios']

type ReadyQueueEnvironment = Record<string, string | undefined>

export interface ReadyQueueOptions {
  board: ReadyQueueBoard
  harness: FixallHarness
}

function parseHarness(value: string | undefined): FixallHarness {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    throw new Error(
      'Fixall harness is required. Pass --harness <name> or set ASTRID_FIXALL_HARNESS.',
    )
  }
  if (!(normalized in FIXALL_HARNESS_MAILBOXES)) {
    throw new Error(
      `Unknown harness "${value}". Expected one of: ${Object.keys(FIXALL_HARNESS_MAILBOXES).join(', ')}`,
    )
  }
  return normalized as FixallHarness
}

/**
 * Parse the portable queue selector contract.
 *
 * The board alone has a backward-compatible default. Identity never does: a
 * missing or misspelled harness must stop rather than claim another harness's
 * assignments. A CLI selector overrides the environment for scheduled jobs
 * that deliberately run multiple harnesses.
 */
export function resolveReadyQueueOptions(
  argv: string[],
  env: ReadyQueueEnvironment,
): ReadyQueueOptions {
  let board: ReadyQueueBoard = 'web'
  let boardSeen = false
  let cliHarness: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--harness') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--harness requires a value')
      }
      cliHarness = value
      index += 1
      continue
    }
    if (arg.startsWith('--harness=')) {
      cliHarness = arg.slice('--harness='.length)
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option "${arg}"`)
    }
    if (boardSeen) {
      throw new Error(`Unexpected argument "${arg}"`)
    }
    if (!READY_QUEUE_BOARDS.includes(arg as ReadyQueueBoard)) {
      throw new Error(
        `Unknown board "${arg}". Expected one of: ${READY_QUEUE_BOARDS.join(', ')}`,
      )
    }
    board = arg as ReadyQueueBoard
    boardSeen = true
  }

  return {
    board,
    harness: parseHarness(cliHarness ?? env.ASTRID_FIXALL_HARNESS),
  }
}

export interface StatusRoleTask {
  statusRole?: string | null
  completed?: boolean | null
}

/**
 * Is this task in the Ready column? A ROLE on the task, not a list id.
 *
 * AWTD-562 moved board status off `listType: 'status'` membership and onto
 * `Task.statusRole`, because the list model could not be per-user and shared at
 * the same time. The queue read the lists for a while afterwards, which made it
 * a shadow of the real state in both directions: a task Jon marked Ready in the
 * app — which writes only the field — never appeared, and a task still holding a
 * legacy `Ready` membership stayed queued after it had moved on.
 *
 * Exact match on the default role, so a project's custom state that merely reads
 * as ready ("ready-for-review") stays on its own board rather than being swept
 * into an autonomous loop.
 *
 * Completed is checked even though the server nulls the status on completion and
 * the queue asks for open tasks anyway: it is the one condition where a stale
 * value would mean re-doing finished work, and the invariant is worth stating
 * where the queue can see it.
 */
export function hasReadyStatus(task: StatusRoleTask): boolean {
  if (task.completed) return false
  return (task.statusRole ?? '').trim().toLowerCase() === READY_STATUS_ROLE
}

/**
 * A task that may carry a date.
 *
 * `dueDateTime` is the single date field the API returns; `isAllDay` says whether the time
 * within it means anything. An all-day task carries midnight, so it becomes workable at the
 * start of its day, which is what "don't start until the date" means.
 */
export interface SchedulableTask {
  dueDateTime?: string | null
  isAllDay?: boolean | null
}

/**
 * May the loop START this task yet?
 *
 * Jon, 2026-08-19: "If a task has a date don't start until the date or time of the task.
 * Therefore we can have fixall respond to recurring tasks and track them in Astrid."
 *
 * RECURRENCE NEEDS NOTHING ELSE. Completing a repeating task rolls it forward to its next
 * occurrence — that is `RepeatingTaskCalculator`'s job and it already happens — and this rule
 * then holds the task until that moment arrives. So "check recurring tasks" and "respect the
 * date" are one rule seen twice: a recurring chore lands back in the queue by itself, on its
 * own schedule, tracked in Astrid rather than in a cron file no one can see.
 *
 * A task with NO date is workable now, which is every task the loop has taken until today.
 *
 * An UNREADABLE date is treated as no date rather than as "never". Stranding a task on a value
 * nobody can see would look exactly like an empty queue, every run, with nothing saying why —
 * and silence is the failure mode this whole script is written against.
 */
export function isDueToStart(task: SchedulableTask, now: Date): boolean {
  const due = parseDue(task.dueDateTime)
  if (!due) return true
  return due.getTime() <= now.getTime()
}

/**
 * When a held task becomes workable, for the skipped-with-a-reason line. Empty when the task
 * carries no date, so callers can print it unconditionally.
 */
export function describeSchedule(task: SchedulableTask, now: Date): string {
  const due = parseDue(task.dueDateTime)
  if (!due || due.getTime() <= now.getTime()) return ''
  return task.isAllDay
    ? due.toISOString().slice(0, 10)
    : due.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

function parseDue(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export interface AssignableTask {
  assigneeId?: string | null
  assignee?: { email?: string | null; name?: string | null } | null
}

/**
 * May an autonomous loop take this task?
 *
 * ONLY when it is unassigned or assigned to the agent.
 *
 * Still deliberately conservative about missing data: `assignee` may be absent,
 * null, or present without an email depending on how the task was serialised.
 * A malformed assignment that cannot be confirmed reads as somebody else's —
 * claiming on a guess costs duplicated work, skipping costs one line of output
 * saying why.
 */
export function isClaimableByAgent(
  task: AssignableTask,
  harness: FixallHarness | string,
): boolean {
  if (!task.assigneeId) return true

  const email = task.assignee?.email
  if (!email) return false

  const mailbox = FIXALL_HARNESS_MAILBOXES[parseHarness(harness)]
  return email.toLowerCase() === agentEmail(mailbox).toLowerCase()
}

/**
 * Human-readable owner, for explaining why a task was skipped.
 *
 * "unassigned" is now the COMMON skip, not an edge case, so it says so. Printing
 * `unknown` for it read as a data problem and sent a reader looking for a bug that
 * was not there — the task simply had not been handed over yet.
 */
export function describeAssignee(task: AssignableTask): string {
  if (!task.assigneeId) return 'unassigned'
  return task.assignee?.name || task.assignee?.email || task.assigneeId || 'unknown'
}
