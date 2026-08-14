/**
 * Server-side helpers for the PUT-task route's two side-effect blocks that
 * previously used dynamic imports inline:
 *
 *   1. Repeating-task completion: when a task is marked complete and is part
 *      of a repeating series, roll forward / terminate via the existing
 *      handlers and tell the caller to short-circuit.
 *
 *   2. State-change comment: diff old vs new task and persist a system
 *      comment describing what changed.
 *
 * Extracted from app/api/tasks/[id]/route.ts so POST and PUT can share the
 * same orchestration and so the dynamic imports become static (matches the
 * pattern Stage 1 established for reminder scheduling).
 *
 * Reminder rescheduling is in lib/reminder-scheduling.ts (Stage 1) — these
 * three modules together cover the PUT route's three post-update concerns.
 */

import { prisma } from "./prisma"
import { isClosedReason } from "./closed-reason"
import { createLogger } from "./logger"
import {
  handleRepeatingTaskCompletion,
  applyRepeatingTaskRollForward,
} from "./repeating-task-handler"
import {
  detectTaskStateChanges,
  formatStateChangesAsComment,
  type TaskWithRelations,
} from "./task-state-change-tracker"
import { TASK_FULL_INCLUDE, type TaskWithFullRelations } from "./task-query-utils"

const log = createLogger("task-update-handler")

export type RepeatingCompletionOutcome =
  | { rolledForward: false }
  | { rolledForward: true; updatedTask: TaskWithFullRelations }

/**
 * Handle the "task being marked complete might be part of a repeating series
 * that should roll forward (or terminate) instead of staying completed" branch.
 *
 * The repeating-task helpers already mutate the database when the result
 * indicates roll-forward/terminate; this function only orchestrates detection
 * + apply + re-fetch, then signals to the caller whether to short-circuit.
 *
 * Returns rolledForward:true with the freshly-fetched task when the caller
 * should return that task to the client. Returns rolledForward:false when the
 * caller should proceed with the normal update path.
 */
export async function applyRepeatingTaskCompletion(args: {
  taskId: string
  existingCompleted: boolean
  dataCompleted: boolean | undefined
  /** YYYY-MM-DD from client; only used for all-day repeating tasks in COMPLETION_DATE mode. */
  localCompletionDate?: string
  /**
   * Set when the task is being closed as canceled / duplicate / not-planned
   * rather than done (task 11042ae3).
   */
  closedReason?: string | null
}): Promise<RepeatingCompletionOutcome> {
  const { taskId, existingCompleted, dataCompleted, localCompletionDate, closedReason } = args

  if (dataCompleted === undefined) return { rolledForward: false }

  // Cancelling an occurrence must not spawn the next one (task 11042ae3).
  // "We're not doing this one" and "this one is done, schedule the next" are
  // opposite intents, and rolling forward on a cancel would resurrect the very
  // task the user just decided to drop — every week, forever.
  if (dataCompleted && isClosedReason(closedReason)) {
    return { rolledForward: false }
  }

  const result = await handleRepeatingTaskCompletion(
    taskId,
    existingCompleted,
    dataCompleted,
    localCompletionDate,
  )

  if (!result?.shouldRollForward && !result?.shouldTerminate) {
    return { rolledForward: false }
  }

  await applyRepeatingTaskRollForward(taskId, result)

  const updatedTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_FULL_INCLUDE,
  })

  if (!updatedTask) {
    throw new Error(`Task ${taskId} not found after roll-forward`)
  }

  log.info(
    {
      taskId,
      action: result.shouldRollForward ? "rolled_forward" : "terminated",
    },
    "Applied repeating task completion",
  )

  return { rolledForward: true, updatedTask: updatedTask as TaskWithFullRelations }
}

/**
 * Diff the pre-update and post-update task and persist a system-authored
 * comment describing the changes. Returns the new comment row (so the caller
 * can prepend it to the task's comments array for the response), or null if
 * no changes were detected or comment creation failed.
 *
 * Errors are logged but never thrown — a failed state-change comment must
 * never fail the surrounding task update.
 */
export async function recordStateChangeComment(args: {
  existingTask: TaskWithRelations
  // Deliberately TaskWithRelations, not TaskWithFullRelations. This function
  // reads only `id`, `completed`, and whatever detectTaskStateChanges compares
  // — it never touches the comment/attachment relations the fuller type
  // demands. Requiring them locked the helper to callers that select the exact
  // legacy include, which is why v1 grew its own copy instead of reusing this.
  // (Task efecc4b8.)
  updatedTask: TaskWithRelations
  updaterName: string
}) {
  const { existingTask, updatedTask, updaterName } = args

  try {
    const stateChanges = detectTaskStateChanges(existingTask, updatedTask, updaterName)
    if (stateChanges.length === 0) return null

    const commentContent = formatStateChangesAsComment(stateChanges, updaterName)

    // Typed discriminator for the completion-streak fold (task 59e2dcff).
    // Derived from the structured StateChange, never from the rendered prose —
    // the whole point is that clients stop pattern-matching English.
    //
    // Only set when completion is the SOLE change: a comment that also reports
    // a priority or due-date edit is not a bare completion event, and folding
    // it into a streak would hide those edits.
    const systemEventType =
      stateChanges.length === 1 && stateChanges[0].field === 'completed'
        ? updatedTask.completed ? 'COMPLETED' : 'REOPENED'
        : null

    const comment = await prisma.comment.create({
      data: {
        taskId: updatedTask.id,
        authorId: null,
        content: commentContent,
        type: "TEXT",
        systemEventType,
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: { author: true, secureFiles: true },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    log.info(
      { taskId: updatedTask.id, changes: stateChanges.length },
      "Created state change comment",
    )
    return comment
  } catch (err) {
    log.error(
      { err, taskId: updatedTask.id },
      "Failed to create state change comment",
    )
    return null
  }
}

/**
 * Persist a system-authored comment recording that a task was created, e.g.
 * "Jon Paris created this task". Mirrors recordStateChangeComment: a "system"
 * comment is simply one with authorId: null (there is no dedicated comment
 * type), and it renders in the task-detail thread behind the "Show system"
 * toggle. Call this only from the genuine create paths — never from an
 * idempotent duplicate-return branch, or a retry would double-post.
 *
 * Errors are logged but never thrown — a failed creation comment must never
 * fail the surrounding task creation.
 */
export async function recordTaskCreationComment(args: {
  taskId: string
  creatorName: string
}) {
  const { taskId, creatorName } = args

  try {
    const comment = await prisma.comment.create({
      data: {
        taskId,
        authorId: null,
        content: `${creatorName} created this task`,
        type: "TEXT",
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: { author: true, secureFiles: true },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    log.info({ taskId }, "Created task creation comment")
    return comment
  } catch (err) {
    log.error({ err, taskId }, "Failed to create task creation comment")
    return null
  }
}
