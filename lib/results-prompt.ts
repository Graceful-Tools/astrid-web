/**
 * The Pending results picker's plumbing (ADEV-282), the Waiting prompt's twin (lib/waiting-prompt.ts).
 *
 * A move into the Pending results column that the server refuses with 422 `RESULTS_NEEDS_CONDITION`
 * asks `requestResultsCondition` and awaits the person's answer; components/ResultsPromptHost.tsx
 * draws the dialog. Resolves `true` once a link or a verification exists (the caller sends the move
 * again), `false` on cancel. Loaded on demand by the task controller, and the host subscribes
 * through here, so a page's first load carries neither (the AWTD-1593 budget).
 */
import { RESULTS_NEEDS_CONDITION } from '@/lib/results-rules'

/** The task the prompt is about: enough to link it and name it. */
export interface ResultsPromptTask {
  id: string
  title?: string
  lists?: ReadonlyArray<{ id: string; projectId?: string | null }> | null
}

export interface ResultsPromptRequest {
  task: ResultsPromptTask
  resolve: (linked: boolean) => void
}

type Listener = (request: ResultsPromptRequest | null) => void
let listener: Listener | null = null
let pending: ResultsPromptRequest | null = null

/** Whether an API error is the server asking what a task in Pending results waits for. */
export function isResultsNeedsCondition(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { status, detail } = error as { status?: number; detail?: unknown }
  return status === 422 && Boolean(detail) && (detail as { code?: string }).code === RESULTS_NEEDS_CONDITION
}

/** The host registers here; one at a time. Returns the unsubscribe. */
export function subscribeResultsPrompt(next: Listener): () => void {
  listener = next
  if (pending) next(pending)
  return () => {
    if (listener === next) listener = null
  }
}

/** Ask the person what a task waits for. Resolves `false` on cancel. */
export function requestResultsCondition(task: ResultsPromptTask): Promise<boolean> {
  return new Promise(resolve => {
    // A second request replaces the first, which is cancelled: one prompt at a time.
    pending?.resolve(false)
    const request: ResultsPromptRequest = {
      task,
      resolve: linked => {
        if (pending === request) pending = null
        listener?.(null)
        resolve(linked)
      },
    }
    pending = request
    listener?.(request)
  })
}
