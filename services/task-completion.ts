/**
 * What completing or reopening a task writes.
 *
 * Three decisions that only ever fire together — the completion stamp, its
 * provenance, and the board lane — lifted out of `updateTaskWithSideEffects`
 * so they are one readable unit and so `services/task.service.ts` stays under
 * the oversized-files ratchet (task 9377bc2c), which asks for a piece to come
 * out rather than for the number to go up.
 *
 * The board rule itself stays in lib/task-status.ts beside `resolveColumnMove`:
 * this module decides WHEN it applies, that one decides WHAT it says.
 */

import { parseClosedReason } from '@/lib/closed-reason'
import { parseCompletionStamp } from '@/lib/task-enums'
import { resolveCompletionStatusTransition } from '@/lib/task-status'

export interface CompletionFieldsInput {
  /** `completed` as the request asked for it, or undefined if it said nothing. */
  requestedCompleted: boolean | undefined
  /** The update intent, for the completion stamp fields. */
  intent: { completedAt?: string | Date | null; completedSource?: string | null }
  /** The pre-update row: its lane, its stashed lane, and who it is assigned to. */
  existingTask: {
    completed?: boolean | null
    statusRole?: string | null
    statusRoleBeforeDone?: string | null
    assignee?: { isAIAgent?: boolean | null } | null
  }
}

export type CompletionFieldsResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export function resolveCompletionFields({
  requestedCompleted,
  intent,
  existingTask,
}: CompletionFieldsInput): CompletionFieldsResult {
  const data: Record<string, unknown> = {}

  // Completion stamp and provenance. Sync may backdate completedAt to the
  // provider's real completion time; completedSource records where it happened
  // (astrid | google | github | apple).
  if (requestedCompleted === true) {
    // Validated, not coerced — parseCompletionStamp says why (AWTD-873).
    const stamp = parseCompletionStamp(intent)
    if (!stamp.ok) return { ok: false, error: stamp.error }
    // Absent means the server stamps now; that default is this layer's call.
    data.completedAt = stamp.value.completedAt ?? new Date()
    data.completedSource = stamp.value.completedSource
  } else if (requestedCompleted === false) {
    data.completedAt = null
    data.completedSource = null
    // A reopened task is not a canceled one (task 11042ae3).
    data.closedReason = null
  }

  // Done still carries no board status (AWTD-562) — but the lane it came from
  // is now remembered, so reopening can put it back rather than dropping the
  // task into Inbox where the agent queue cannot see it (AWTD-964).
  Object.assign(
    data,
    resolveCompletionStatusTransition({
      requestedCompleted,
      currentStatusRole: existingTask.statusRole,
      rememberedStatusRole: existingTask.statusRoleBeforeDone,
      currentCompleted: existingTask.completed === true,
      // `assignee` is in both of the includes this service reads an existing
      // task with. A surface that passed a leaner one gets `false`, which is
      // the conservative answer: the task stays where it was.
      assigneeIsAgent: existingTask.assignee?.isAIAgent === true,
    }),
  )

  return { ok: true, data }
}

/**
 * What a CREATE may say about a task that arrives already done (AWTD-1123).
 *
 * GitHub issue import is the caller that needs it: a closed issue becomes a
 * completed task in one write, carrying when it was closed, where, and why.
 */
export interface CreateCompletionInput {
  completedAt?: string | Date | null
  completedSource?: string | null
  closedReason?: string | null
}

/**
 * The completion columns for a new task, by the update path's rules: validated
 * by the same parsers, stamped now when no stamp was given, and written only
 * when the task is created completed. An open task has nothing to stamp.
 */
export function resolveCreateCompletionFields(
  completed: boolean,
  input: CreateCompletionInput,
): CompletionFieldsResult {
  if (!completed) return { ok: true, data: {} }

  const stamp = parseCompletionStamp(input)
  if (!stamp.ok) return { ok: false, error: stamp.error }
  const closedReason = parseClosedReason(input.closedReason)
  if (!closedReason.ok) return { ok: false, error: closedReason.error }

  return {
    ok: true,
    data: {
      completedAt: stamp.value.completedAt ?? new Date(),
      completedSource: stamp.value.completedSource,
      closedReason: closedReason.value,
    },
  }
}
