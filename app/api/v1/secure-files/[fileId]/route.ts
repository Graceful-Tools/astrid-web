/**
 * GET/PUT/DELETE /api/v1/secure-files/[fileId]
 *
 * v1 mount point for the SecureFile fetch/update/delete endpoint. Re-exports
 * the legacy handlers — file responses are binary, so there is no `meta`
 * envelope to add.
 *
 * DELETE was missing here while the legacy route implemented it, so there was
 * no v1 way to delete a file at all. That blocks retiring the legacy route,
 * not just the two callers that delete attachments. (Task 641a7615)
 *
 * Because it is a re-export, this mount inherited the legacy handler's
 * cookie-only authentication and was the one `/api/v1/*` surface that ignored
 * `X-OAuth-Token` — so no OAuth client could read an attachment at all. The
 * token path lives in the legacy handler rather than in a wrapper here, on
 * purpose: a wrapper would make these two mounts different function objects
 * and let their authorization drift. (AWTD-982)
 */

export { GET, PUT, DELETE } from '../../../secure-files/[fileId]/route'
