/**
 * The Waiting prompt's plumbing (Jon, 2026-11-12): "If a user moves a task there it should prompt
 * the user to pick a date or indicate a task."
 *
 * Any place that moves a task into Waiting — a board drop, the status picker, the task menu — or
 * that gets a 422 `WAITING_NEEDS_CONDITION` back, asks `requestWaitingCondition` (lib/waiting-prompt-bus.ts)
 * and awaits the person's answer; components/WaitingPromptHost.tsx draws the dialog. Cancel resolves
 * `null`, and the caller leaves the task where it was. The task controller loads this module on
 * demand, so it is not in any page's first load.
 */
import { isWaitingTask, WAITING_NEEDS_CONDITION, WAITING_ROLE, type WaitingTask } from '@/lib/waiting-rules'
import { requestWaitingCondition, type WaitingChoice, type WaitingPromptTask } from '@/lib/waiting-prompt-bus'

export type { WaitingChoice, WaitingPromptRequest, WaitingPromptTask } from '@/lib/waiting-prompt-bus'
export { requestWaitingCondition, subscribeWaitingPrompt } from '@/lib/waiting-prompt-bus'

/** Whether an edit moves a task INTO Waiting (from any other lane, or from Done). */
export function entersWaiting(original: WaitingTask, updated: WaitingTask): boolean {
  return !updated.completed && updated.statusRole === WAITING_ROLE && !isWaitingTask(original)
}

/** The edit with the person's answer folded in, and the extra fields the PUT carries. */
export function applyWaitingChoice<T extends { dueDateTime?: Date | null; isAllDay?: boolean }>(
  task: T,
  choice: WaitingChoice,
): { task: T; extra: Record<string, unknown> } {
  const extra: Record<string, unknown> = { keepAssignee: choice.keepAssignee }
  if (choice.mode === 'task') {
    extra.waitOnTaskId = choice.waitOnTaskId
    return { task, extra }
  }
  return { task: { ...task, dueDateTime: new Date(choice.dueDateTime), isAllDay: true }, extra }
}

/** Whether an API error is the server asking for a wait condition. */
export function isWaitingNeedsCondition(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { status, detail } = error as { status?: number; detail?: unknown }
  return status === 422 && Boolean(detail) && (detail as { code?: string }).code === WAITING_NEEDS_CONDITION
}

/**
 * For a task being CREATED into Waiting (a board's add-card in the Waiting column): ask, and
 * answer the extra POST fields. `undefined` when the create is not into Waiting; `null` when the
 * person cancelled, so nothing is created.
 */
export async function waitingFieldsForCreate(
  statusRole: string | null | undefined,
  draft: { title: string; dueDateTime?: Date | string | null; isAllDay?: boolean; assigneeId?: string | null; listIds: string[] },
): Promise<Record<string, unknown> | null | undefined> {
  const task: WaitingPromptTask = {
    id: 'new-task',
    title: draft.title,
    dueDateTime: draft.dueDateTime ?? null,
    isAllDay: draft.isAllDay ?? false,
    assigneeId: draft.assigneeId ?? null,
    lists: draft.listIds.map(id => ({ id })),
  }
  if (statusRole !== WAITING_ROLE) return undefined
  const choice = await requestWaitingCondition(task)
  if (!choice) return null
  return choice.mode === 'task'
    ? { keepAssignee: choice.keepAssignee, waitOnTaskId: choice.waitOnTaskId }
    : { keepAssignee: choice.keepAssignee, dueDateTime: choice.dueDateTime, isAllDay: true }
}

/**
 * Send an edit, asking first when it moves the task into Waiting, and again if the server answers
 * 422 `WAITING_NEEDS_CONDITION` to an edit sent without an answer. `send` writes (and rolls back
 * its own optimistic change on failure); cancel at either prompt sends nothing more.
 */
export async function sendWithWaitingPrompt<T extends WaitingTask & WaitingPromptTask & { dueDateTime?: Date | null; isAllDay?: boolean }>(
  original: WaitingTask,
  requested: T,
  send: (task: T, extra: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  let choice: WaitingChoice | null = null
  if (entersWaiting(original, requested)) {
    choice = await requestWaitingCondition(requested)
    if (!choice) return
  }
  for (;;) {
    const applied = choice ? applyWaitingChoice(requested, choice) : { task: requested, extra: {} }
    try {
      await send(applied.task, applied.extra)
      return
    } catch (error) {
      if (choice || !isWaitingNeedsCondition(error)) throw error
      choice = await requestWaitingCondition(requested)
      if (!choice) return
    }
  }
}
