/**
 * Argv for `scripts/set-task-status.ts`, parsed where it can be tested.
 *
 * Waiting carries its condition IN THE SAME WRITE (astrid-core waiting rules,
 * enforced by the server): a task may enter Waiting only while it waits on a
 * date (a future `dueDateTime`) or on an incomplete blocking task. The server
 * refuses anything else with `WAITING_NEEDS_CONDITION`, so this refuses it first,
 * with a message that says what to pass instead of a bare HTTP 400.
 *
 * Entering Waiting clears the assignee unless the mover keeps it
 * (`--keep-assignee`). "Waiting on a person" is not Waiting at all: hand it back
 * with `assign-task.ts <taskId> <email> --handback` (the Inbox, assigned to them).
 */

import { DEFAULT_STATES, WAITING_STATUS_ROLE } from '@/lib/task-status'

/** Flags that take a value, consumed together with it (AWTD-922). */
const VALUED_FLAGS = new Set(['--agent', '--until', '--blocked-by'])

export const STATUS_NAMES = DEFAULT_STATES.map(state => state.name).join('|')

export const SET_TASK_STATUS_USAGE =
  `Usage: npx tsx scripts/set-task-status.ts <taskId> <${STATUS_NAMES}> [--agent <mailbox>]\n` +
  '       npx tsx scripts/set-task-status.ts <taskId> Waiting (--until <ISO date> | --blocked-by <task id|identifier>) [--keep-assignee] [--agent <mailbox>]'

export const WAITING_NEEDS_CONDITION_MESSAGE =
  'Waiting needs a condition in the same call: --until <ISO date in the future> (the date it is rechecked) ' +
  'or --blocked-by <task id|identifier> (the task it waits on). Waiting on a person is not Waiting — ' +
  'hand it back with `assign-task.ts <taskId> <email> --handback`.'

export interface SetTaskStatusArgs {
  taskId: string
  /** The stored role: `ready`, `doing` or `waiting`. */
  role: string
  /** The display name, for messages. */
  name: string
  /** The PUT body's status fields — sent in ONE write so the server sees the condition with the move. */
  body: {
    statusRole: string
    dueDateTime?: string
    waitOnTaskId?: string
    keepAssignee?: true
  }
}

export function parseSetTaskStatusArgs(argv: string[], now: Date = new Date()): SetTaskStatusArgs {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  let keepAssignee = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--keep-assignee') {
      keepAssignee = true
      continue
    }
    if (VALUED_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      flags[arg] = value
      i++
      continue
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option "${arg}"\n${SET_TASK_STATUS_USAGE}`)
    positional.push(arg)
  }

  const [taskId, statusArg] = positional
  if (!taskId || !statusArg || positional.length > 2) throw new Error(SET_TASK_STATUS_USAGE)

  // The display name ("Waiting") or the stored role ("waiting"), case-insensitively.
  const wanted = statusArg.trim().toLowerCase()
  const status = DEFAULT_STATES.find(state => state.role === wanted || state.name.toLowerCase() === wanted)
  if (!status) throw new Error(`Unknown status "${statusArg}". Expected one of: ${STATUS_NAMES}`)

  const until = flags['--until']
  const blockedBy = flags['--blocked-by']?.trim()
  if (status.role !== WAITING_STATUS_ROLE) {
    if (until !== undefined || blockedBy !== undefined || keepAssignee) {
      throw new Error('--until, --blocked-by and --keep-assignee apply only to Waiting')
    }
    return { taskId, role: status.role, name: status.name, body: { statusRole: status.role } }
  }

  if (until === undefined && !blockedBy) throw new Error(WAITING_NEEDS_CONDITION_MESSAGE)

  let dueDateTime: string | undefined
  if (until !== undefined) {
    const parsed = new Date(until)
    if (Number.isNaN(parsed.getTime())) throw new Error(`--until "${until}" is not an ISO date`)
    if (parsed.getTime() <= now.getTime()) {
      throw new Error(`--until ${parsed.toISOString()} is not in the future; a date that has passed is no condition`)
    }
    dueDateTime = parsed.toISOString()
  }

  return {
    taskId,
    role: status.role,
    name: status.name,
    body: {
      statusRole: status.role,
      ...(dueDateTime ? { dueDateTime } : {}),
      ...(blockedBy ? { waitOnTaskId: blockedBy } : {}),
      ...(keepAssignee ? { keepAssignee: true as const } : {}),
    },
  }
}
