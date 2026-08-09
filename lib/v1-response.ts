/**
 * Reading a resource out of a legacy or v1 response. (Task 641a7615, step 3)
 *
 * The two surfaces disagree about the envelope, and the disagreement is the
 * single most dangerous thing about migrating call sites:
 *
 *   legacy GET/PUT /api/tasks/[id]   ->  the task object, bare
 *   v1     GET/PUT /api/v1/tasks/[id]  -> { task, meta }
 *   legacy GET/PUT /api/lists/[id]     ->  the list object, bare
 *   v1     GET/PUT /api/v1/lists/[id]  -> { list, meta }
 *
 * A path swap alone therefore leaves the caller holding `{ task, meta }` and
 * reading `.id` off it — `undefined`, with no error. That is not theoretical:
 * a script of mine read `body.lists` off a v1 response, got `undefined`,
 * computed an empty membership list and stripped a task off every board.
 *
 * These accept either shape so a call site can move paths without the caller
 * and the endpoint having to change in the same breath. They return null rather
 * than guessing when the body is neither — a null the caller must handle beats
 * a plausible-looking object that is missing every field.
 *
 * Lists get the same treatment as tasks rather than a second copy of the logic,
 * because the two envelopes differ only in their key.
 */

/** A response body that is either the resource itself or the v1 envelope around it. */
export type EnvelopedBody<T, K extends string> = T | Record<K, T> | null | undefined

/**
 * @param key the v1 envelope key — `'task'` for tasks, `'list'` for lists.
 */
export function unwrapEnvelope<T extends { id?: unknown }, K extends string>(
  body: EnvelopedBody<T, K>,
  key: K
): T | null {
  if (!body || typeof body !== 'object') return null

  // v1: { <key>, meta }. Checked first — a v1 envelope has no `id` of its own,
  // so order only matters if a resource ever gains a field named for its own
  // type, which would be ambiguous under any rule.
  const enveloped = (body as Record<string, unknown>)[key]
  if (enveloped && typeof enveloped === 'object') {
    return enveloped as T
  }

  // Legacy: the resource, bare. Identified by having an id, not by absence of
  // the envelope — an error body like `{ error: '...' }` must not pass as one.
  if ('id' in body && typeof (body as T).id === 'string') {
    return body as T
  }

  return null
}

export function unwrapTask<T extends { id?: unknown }>(
  body: EnvelopedBody<T, 'task'>
): T | null {
  return unwrapEnvelope(body, 'task')
}

export function unwrapList<T extends { id?: unknown }>(
  body: EnvelopedBody<T, 'list'>
): T | null {
  return unwrapEnvelope(body, 'list')
}
