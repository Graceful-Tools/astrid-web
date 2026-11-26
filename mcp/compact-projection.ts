/**
 * Opt-in compact output for the MCP read tools (AWTD-1553).
 *
 * A leaf on purpose: no imports, because the standalone stdio server is built with
 * `tsc --ignoreConfig` (see mcp/build-mcp-oauth.js).
 *
 * Nothing here runs unless the caller asks (`compact: true`, `limit`, `before`),
 * so a call that passes none of them gets the pretty-printed, full-description
 * output it always did.
 */

export const DEFAULT_COMPACT_DESCRIPTION_CHARS = 600

export interface CompactOptions {
  compact?: boolean
  maxDescriptionChars?: number
}

/** The JSON a tool returns: two-space pretty by default, one line when compact. */
export function toolJson(data: unknown, compact?: boolean): string {
  return compact ? JSON.stringify(data) : JSON.stringify(data, null, 2)
}

/** Cut `text` to `max` characters and say how much was dropped, so nobody mistakes it for the whole. */
export function truncateWithMarker(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars; get_task returns the full description]`
}

function budget(options: CompactOptions): number {
  const n = options.maxDescriptionChars
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_COMPACT_DESCRIPTION_CHARS
}

function truncateDescription<T>(task: T, max: number): T {
  const description = (task as { description?: unknown } | null)?.description
  if (typeof description !== 'string') return task
  return { ...task, description: truncateWithMarker(description, max) }
}

/** A task with its description truncated. Other fields pass through untouched. */
export function compactTask<T>(task: T, options: CompactOptions): T {
  return options.compact ? truncateDescription(task, budget(options)) : task
}

/** The queue response with every queued and attention task's description truncated. */
export function compactQueue<T>(data: T, options: CompactOptions): T {
  if (!options.compact || !data || typeof data !== 'object') return data
  const max = budget(options)
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  if (Array.isArray(out.queue)) out.queue = out.queue.map(task => truncateDescription(task, max))
  const attention = out.attention as { tasks?: unknown } | undefined
  if (attention && Array.isArray(attention.tasks)) {
    out.attention = { ...attention, tasks: attention.tasks.map(task => truncateDescription(task, max)) }
  }
  return out as T
}

export interface CommentPageOptions {
  limit?: number
  /** Cursor from a previous page: return the comments older than this comment id. */
  before?: string
}

export interface CommentPage<C> {
  comments: C[]
  /** Pass as `before` to read the page of older comments. Absent when this page reaches the start. */
  nextCursor?: string
  totalCount: number
}

/**
 * The newest `limit` comments (oldest first, as the API returns them), ending
 * just before `before` when a cursor is given. Returns null when neither is set:
 * the caller then returns the unbounded history unchanged.
 */
export function pageComments<C extends { id?: string }>(
  comments: C[],
  { limit, before }: CommentPageOptions,
): CommentPage<C> | null {
  if (limit === undefined && before === undefined) return null
  let end = comments.length
  if (before !== undefined) {
    const at = comments.findIndex(comment => comment.id === before)
    if (at < 0) throw new Error(`Unknown comment cursor: ${before}`)
    end = at
  }
  const size = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : end
  const start = Math.max(0, end - size)
  const page = comments.slice(start, end)
  const first = page[0]?.id
  return {
    comments: page,
    ...(start > 0 && first ? { nextCursor: first } : {}),
    totalCount: comments.length,
  }
}
