/**
 * The Waiting prompt's plumbing (Jon, 2026-11-12): "If a user moves a task there it should prompt
 * the user to pick a date or indicate a task."
 *
 * Any place that moves a task into Waiting — a board drop, the status picker, the task menu — or
 * that gets a 422 `WAITING_NEEDS_CONDITION` back, asks {@link requestWaitingCondition} and awaits the
 * person's answer. One host (components/WaitingConditionPrompt.tsx, mounted in providers.tsx) draws
 * the dialog. Cancel resolves `null`, and the caller leaves the task where it was.
 */
import { isWaitingTask, WAITING_NEEDS_CONDITION, WAITING_ROLE, type WaitingTask } from '@/lib/waiting-rules'

/** What the person chose. */
export type WaitingChoice = {
  keepAssignee: boolean
} & (
  | { mode: 'date'; /** An all-day date, as the server stores one: midnight UTC. */ dueDateTime: string }
  | { mode: 'task'; waitOnTaskId: string }
)

/** The task the prompt is about: enough to prefill it and label "Keep assigned to …". */
export interface WaitingPromptTask {
  id: string
  title?: string
  dueDateTime?: Date | string | null
  isAllDay?: boolean | null
  assigneeId?: string | null
  assignee?: { id: string; name?: string | null; email?: string | null } | null
  lists?: ReadonlyArray<{ id: string }> | null
}

export interface WaitingPromptRequest {
  task: WaitingPromptTask
  resolve: (choice: WaitingChoice | null) => void
}

type Listener = (request: WaitingPromptRequest | null) => void
let listener: Listener | null = null
let pending: WaitingPromptRequest | null = null

/** The host registers here; one at a time. Returns the unsubscribe. */
export function subscribeWaitingPrompt(next: Listener): () => void {
  listener = next
  if (pending) next(pending)
  return () => {
    if (listener === next) listener = null
  }
}

/** Ask the person what a task waits for. Resolves `null` on cancel, or when no host is mounted. */
export function requestWaitingCondition(task: WaitingPromptTask): Promise<WaitingChoice | null> {
  return new Promise(resolve => {
    if (!listener) {
      resolve(null)
      return
    }
    // A second request replaces the first, which is cancelled: one prompt at a time.
    pending?.resolve(null)
    const request: WaitingPromptRequest = {
      task,
      resolve: choice => {
        if (pending === request) pending = null
        listener?.(null)
        resolve(choice)
      },
    }
    pending = request
    listener(request)
  })
}

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
