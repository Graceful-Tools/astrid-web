/**
 * Reading a task out of a task response, legacy or v1. (Task 641a7615, step 3)
 *
 * The two surfaces disagree about the envelope, and the disagreement is the
 * single most dangerous thing about migrating call sites:
 *
 *   legacy GET/PUT /api/tasks/[id]  ->  the task object, bare
 *   v1     GET/PUT /api/v1/tasks/[id] -> { task, meta }
 *
 * A path swap alone therefore leaves the caller holding `{ task, meta }` and
 * reading `.id` off it — `undefined`, with no error. That is not theoretical:
 * a script of mine read `body.lists` off a v1 response, got `undefined`,
 * computed an empty membership list and stripped a task off every board.
 *
 * `unwrapTask` accepts either shape so a call site can move paths without the
 * caller and the endpoint having to change in the same breath. It returns null
 * rather than guessing when the body is neither — a null the caller must
 * handle beats a plausible-looking object that is missing every field.
 */

/** A response body that is either the task itself or the v1 envelope around it. */
export type TaskResponseBody<T> = T | { task: T } | null | undefined

export function unwrapTask<T extends { id?: unknown }>(body: TaskResponseBody<T>): T | null {
  if (!body || typeof body !== 'object') return null

  // v1: { task, meta }. Checked first — a v1 envelope has no `id` of its own,
  // so order only matters if a task ever gains a `task` field, which would be
  // ambiguous under any rule.
  if ('task' in body && body.task && typeof body.task === 'object') {
    return body.task as T
  }

  // Legacy: the task, bare. Identified by having an id, not by absence of the
  // envelope — an error body like `{ error: '...' }` must not pass as a task.
  if ('id' in body && typeof (body as T).id === 'string') {
    return body as T
  }

  return null
}
