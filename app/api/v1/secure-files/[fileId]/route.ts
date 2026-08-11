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
 */

export { GET, PUT, DELETE } from '../../../secure-files/[fileId]/route'
