/**
 * `POST /api/v1/sync/existence` — which of these cached ids are gone? (AWTD-1515)
 *
 * A client holding a cache cannot learn from a delta sync that a row it has
 * stopped being able to SEE is gone: `deletedIds` covers hard deletes, not a
 * list the caller was removed from or a task that moved somewhere private. The
 * only other answer is one `GET /api/v1/tasks/:id` per cached row. This asks
 * for a batch at once.
 *
 * "Missing" means exactly what the per-row GET means: a 403 or a 404 from
 * `GET /api/v1/tasks/:id` or `GET /api/v1/lists/:id`. The route reads with the
 * same `where` those GETs read with (`taskReadAccessWhere`,
 * `listReadByIdWhere`), so the two cannot disagree.
 *
 * Pure and dependency-free: the contract-fixture driver runs this exact code.
 */

/** The most ids of EACH kind one request may carry. */
export const V1_EXISTENCE_MAX_IDS = 200

export interface V1ExistenceRequest {
  taskIds?: string[]
  listIds?: string[]
}

export interface V1ExistenceResponse {
  missingTaskIds: string[]
  missingListIds: string[]
  /** The per-kind cap, so a client can size its batches without hardcoding it. */
  maxIds: number
  meta: { apiVersion: 'v1'; authSource: string }
}

export type ParsedExistenceRequest =
  | { ok: true; taskIds: string[]; listIds: string[] }
  | { ok: false; error: string }

/**
 * Validate a request body. Each kind is optional; an absent kind is an empty
 * one. Duplicates are dropped (first occurrence wins the order) AFTER the cap
 * is checked, so the cap is on what the client sent, not what it meant.
 */
export function parseExistenceRequest(body: unknown): ParsedExistenceRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object: { taskIds?: string[], listIds?: string[] }' }
  }
  const raw = body as Record<string, unknown>
  const out: Record<'taskIds' | 'listIds', string[]> = { taskIds: [], listIds: [] }
  for (const key of ['taskIds', 'listIds'] as const) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && id.length > 0)) {
      return { ok: false, error: `${key} must be an array of non-empty strings` }
    }
    if (value.length > V1_EXISTENCE_MAX_IDS) {
      return {
        ok: false,
        error: `${key} carries ${value.length} ids; the limit is ${V1_EXISTENCE_MAX_IDS} per kind per request`,
      }
    }
    out[key] = [...new Set(value as string[])]
  }
  return { ok: true, ...out }
}

/** The ids asked about that the caller could not read, in the order asked. */
export function missingIds(requested: string[], visible: Iterable<string>): string[] {
  const seen = new Set(visible)
  return requested.filter(id => !seen.has(id))
}

export function shapeExistenceResponse(input: {
  taskIds: string[]
  visibleTaskIds: Iterable<string>
  listIds: string[]
  visibleListIds: Iterable<string>
  authSource: string
}): V1ExistenceResponse {
  return {
    missingTaskIds: missingIds(input.taskIds, input.visibleTaskIds),
    missingListIds: missingIds(input.listIds, input.visibleListIds),
    maxIds: V1_EXISTENCE_MAX_IDS,
    meta: { apiVersion: 'v1', authSource: input.authSource },
  }
}
