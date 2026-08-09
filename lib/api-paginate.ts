/**
 * Reading a whole v1 collection, one page at a time. (Task 641a7615, decision 1B)
 *
 * The legacy routes return every matching row. Their v1 successors cap at
 * `limit` (100 by default, 1000 max) and report `meta: { total, offset, limit }`.
 * So moving a call site from `/api/tasks` to `/api/v1/tasks` without paging
 * would cap the user at 100 tasks — no error, no empty state, just rows that
 * are not there. That reads as data loss, not as a bug, which is why it is
 * worth a helper rather than a `limit=1000` at each call site.
 *
 * Decision 1B was to page properly rather than raise the cap, so this exists to
 * make "page properly" a single well-tested thing instead of ten hand-rolled
 * loops.
 *
 * Everything here is about not stopping early and not never stopping:
 *
 * - a short page ends the walk even if `total` disagrees, because a stale
 *   `total` would otherwise loop asking for rows that will never come
 * - a missing `meta` means the endpoint does not paginate; take the one page
 * - `maxPages` is a hard backstop, and hitting it sets `truncated` so the
 *   caller can tell "that was everything" from "I gave up"
 * - a failed page throws rather than returning a partial list that looks whole
 */

export interface FetchAllPagesOptions {
  /** Rows per request. Defaults to the v1 maximum so most calls take one trip. */
  pageSize?: number
  /** Backstop against a server that never reports completion. */
  maxPages?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
  /** Extra top-level array to concatenate across pages, e.g. `deletedIds`. */
  alsoCollect?: string
  /** Passed through to fetch — callers generally need `credentials: 'include'`. */
  init?: RequestInit
}

export interface FetchAllPagesResult<T> {
  items: T[]
  /** True when the page cap stopped the walk before the server said it was done. */
  truncated: boolean
  /** Concatenation of `alsoCollect` across pages, when requested. */
  collected: unknown[]
}

/** v1 accepts up to 1000; asking for the max keeps most collections to one trip. */
const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_MAX_PAGES = 50

export async function fetchAllPages<T = unknown>(
  url: string,
  itemsKey: string,
  options: FetchAllPagesOptions = {},
): Promise<FetchAllPagesResult<T>> {
  const {
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    fetchImpl = fetch,
    alsoCollect,
    init,
  } = options

  const items: T[] = []
  const collected: unknown[] = []
  let offset = 0
  let pages = 0
  let truncated = false

  for (;;) {
    if (pages >= maxPages) {
      truncated = true
      break
    }

    const separator = url.includes('?') ? '&' : '?'
    const response = await fetchImpl(`${url}${separator}limit=${pageSize}&offset=${offset}`, init)
    pages += 1

    if (!response.ok) {
      // Throwing beats returning what we have: a partial list that presents as
      // complete is the failure this helper exists to prevent.
      throw new Error(`Failed to page ${url} at offset ${offset} (${response.status})`)
    }

    const body = await response.json()
    const pageItems: T[] = body?.[itemsKey] ?? []
    items.push(...pageItems)

    if (alsoCollect && Array.isArray(body?.[alsoCollect])) {
      collected.push(...body[alsoCollect])
    }

    const meta = body?.meta
    // No envelope: this endpoint does not paginate. One page is the answer.
    if (!meta || typeof meta.total !== 'number') break

    // Judge "short page" against what the SERVER says it gave us, not what we
    // asked for. v1 clamps `limit` (Math.min(limit, 1000)), and a server that
    // caps lower than requested would otherwise make every full page look
    // short — stopping after one page and dropping the rest, which is the
    // exact data loss this helper exists to prevent.
    const serverLimit = typeof meta.limit === 'number' && meta.limit > 0 ? meta.limit : pageSize
    if (pageItems.length < serverLimit) break
    if (items.length >= meta.total) break

    offset += pageItems.length
  }

  return { items, truncated, collected }
}
