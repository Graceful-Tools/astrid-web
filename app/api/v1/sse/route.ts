/**
 * GET /api/v1/sse
 *
 * v1 mount point for the Server-Sent Events stream consumed by the iOS app.
 * Re-exports the legacy `/api/sse` handler unchanged — the SSE protocol is
 * not JSON-shaped, so there is no `meta` envelope to add. The point of the
 * v1 path is purely to let iOS migrate off the legacy `/api/*` surface; the
 * stream contract is identical.
 */

export { GET, runtime } from '../../sse/route'
