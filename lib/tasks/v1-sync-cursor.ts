/**
 * The server-issued sync cursor for `GET /api/v1/tasks` (AWTD-1470).
 *
 * Offset paging over the default order (completed, priority, createdAt) is not
 * stable under writes: a task edited mid-sync can move to an earlier page and
 * push another row past the page boundary, which the walk then never returns.
 * A keyset on `(updatedAt, id)` cannot do that — an edit moves its row to the
 * TAIL of the walk, so a row not yet returned is still returned exactly once,
 * and a row already returned comes back again with its new state (an upsert,
 * never a loss).
 *
 * The cursor is opaque to clients: base64url of `{u, i}` — the last row's
 * `updatedAt` (ISO, millisecond precision, which is what Postgres stores for a
 * Prisma DateTime) and `id`. An empty `?cursor=` starts a walk.
 *
 * Pure, so the contract-fixture driver can run it (scripts/contract-fixtures).
 */

export interface TaskSyncCursor {
  updatedAt: Date
  id: string
}

/** The keyset walk's order. `id` breaks ties between rows saved in the same millisecond. */
export const TASK_CURSOR_ORDER_BY = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }]

export function encodeTaskCursor(row: { updatedAt: Date | string; id: string }): string {
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)
  return Buffer.from(JSON.stringify({ u: updatedAt.toISOString(), i: row.id })).toString('base64url')
}

/**
 * `null` for the start of a walk (empty string). Throws on anything else that
 * does not decode: silently restarting would loop a client forever, and
 * silently ignoring would skip it to the end.
 */
export function decodeTaskCursor(raw: string): TaskSyncCursor | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidTaskCursorError()
  }
  const { u, i } = (parsed ?? {}) as { u?: unknown; i?: unknown }
  const updatedAt = typeof u === 'string' ? new Date(u) : null
  if (!updatedAt || Number.isNaN(updatedAt.getTime()) || typeof i !== 'string' || !i) {
    throw new InvalidTaskCursorError()
  }
  return { updatedAt, id: i }
}

export class InvalidTaskCursorError extends Error {
  constructor() {
    super('cursor is not a value this server issued')
  }
}

/** Rows strictly after the cursor in `TASK_CURSOR_ORDER_BY`. */
export function taskCursorWhere(cursor: TaskSyncCursor) {
  return {
    OR: [
      { updatedAt: { gt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
    ],
  }
}
