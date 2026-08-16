/**
 * Which Ready tasks an autonomous loop may take.
 *
 * `Ready` means "this is actionable". It does not mean "this is unclaimed", and
 * the two came apart the moment tasks started being assigned: a loop that works
 * everything in Ready will redo work a person is already doing, or write a
 * second fix for something Jon has half-finished.
 *
 * So the queue needs both conditions — on this board, AND handed to this exact
 * harness identity deliberately. This module owns the second one.
 *
 * Lives in lib/ rather than inside scripts/ready-tasks.ts because that script
 * calls main() at import, so the rule could not otherwise be tested without
 * firing a network request.
 */

import {
  AGENT_MAILBOXES,
  agentEmail,
  type AgentMailbox,
} from '@/lib/brand/agent-emails'

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

export interface AssignableTask {
  assigneeId?: string | null
  assignee?: { email?: string | null; name?: string | null } | null
}

/**
 * May an autonomous loop take this task?
 *
 * ONLY when it is assigned to the agent. Assignment is the handshake.
 *
 * Unassigned used to qualify too, on the reasoning that nobody had claimed it
 * (Jon, 2026-08-15: "only chose tasks assigned to Claude"). That reading made
 * `Ready` mean "actionable AND unclaimed", so anything dropped into Ready to
 * think about was fair game for a loop that would start on it within fifteen
 * minutes. Requiring the assignment inverts the default: nothing is the loop's
 * until someone hands it over, and Ready can go back to meaning only "ready".
 *
 * Still deliberately conservative about missing data: `assignee` may be absent,
 * null, or present without an email depending on how the task was serialised.
 * An assignment that cannot be confirmed reads as somebody else's — claiming on
 * a guess costs duplicated work, skipping costs one line of output saying why.
 */
export function isClaimableByAgent(
  task: AssignableTask,
  harness: FixallHarness | string,
): boolean {
  if (!task.assigneeId) return false

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
