/**
 * GET /api/v1/sse
 *
 * v1 mount point for the Server-Sent Events stream consumed by the iOS app.
 * Re-exports the legacy `/api/sse` handler unchanged — the SSE protocol is
 * not JSON-shaped, so there is no `meta` envelope to add. The point of the
 * v1 path is purely to let iOS migrate off the legacy `/api/*` surface; the
 * stream contract is identical.
 */

export { GET } from '../../sse/route'

// Next 16 reads route segment config statically and cannot follow a re-export, so
// `runtime` is declared here rather than forwarded. It must stay in step with
// app/api/sse/route.ts, which declares the same value.
export const runtime = 'nodejs'

// Same reason as `runtime` above: route segment config is read statically and
// cannot be followed through a re-export, so the ceiling is declared again
// here and must stay in step with app/api/sse/route.ts. iOS connects to THIS
// path, so when only the legacy route was configured, every mobile client was
// the one being cut off at 30s (task 0f544a13).
export const maxDuration = 300
