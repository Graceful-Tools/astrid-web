/**
 * The Waiting prompt's request channel (Jon, 2026-11-12) — the only part of it every page carries.
 *
 * components/WaitingPromptHost.tsx subscribes; lib/waiting-prompt.ts (loaded on demand by the
 * task controller) asks. Imports nothing, so it costs a page's first load almost nothing (the
 * AWTD-1593 budget).
 */

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

/** Ask the person what a task waits for. Resolves `null` on cancel. */
export function requestWaitingCondition(task: WaitingPromptTask): Promise<WaitingChoice | null> {
  return new Promise(resolve => {
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
    // The host is loaded after hydration; until it subscribes, the request waits for it.
    listener?.(request)
  })
}
