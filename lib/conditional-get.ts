/**
 * Conditional reads for per-user JSON routes (AWTD-1509, AWTD-1514).
 *
 * The tag is a hash of the part of the payload that describes state — so it
 * covers membership as well as content (a list the caller lost access to
 * disappears from the payload, and the hash moves), and it never depends on a
 * per-request clock such as `serverTime`, which must be left out of `tagged`.
 *
 * Shape matches GET /api/v1/features: ETag on every 200, 304 with the same tag
 * and no body on a match, and `Cache-Control: private, no-cache` because the
 * response belongs to one user and must never land in a shared cache.
 */
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'

export function payloadEtag(prefix: string, tagged: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(tagged)).digest('base64url').slice(0, 27)
  return `"${prefix}-${digest}"`
}

/** RFC 9110 §13.1.2: a list of tags, `*`, and weak comparison. */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false
  const opaque = etag.replace(/^W\//, '')
  return header
    .split(',')
    .map(candidate => candidate.trim())
    .some(candidate => candidate === '*' || candidate.replace(/^W\//, '') === opaque)
}

/**
 * Answers 304 when the request already holds `tagged`'s tag, otherwise the
 * JSON `body` with the tag. `tagged` defaults to `body`; pass a narrower value
 * when `body` carries anything that changes on every request.
 */
export function conditionalJson(
  req: Request,
  prefix: string,
  body: unknown,
  { tagged = body, headers = {} }: { tagged?: unknown; headers?: Record<string, string> } = {},
): NextResponse {
  const etag = payloadEtag(prefix, tagged)
  const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' }
  if (ifNoneMatchHits(req.headers.get('if-none-match'), etag)) {
    return new NextResponse(null, { status: 304, headers: { ...headers, ...cacheHeaders } })
  }
  return NextResponse.json(body, { headers: { ...headers, ...cacheHeaders } })
}
