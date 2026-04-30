/**
 * POST /api/v1/secure-files/[fileId]/confirm-upload
 *
 * v1 mount point for the SecureFile upload chain step 4 (confirm Blob
 * upload completed and persist metadata). Re-exports the legacy handler.
 */

export { POST } from '../../../../secure-files/[fileId]/confirm-upload/route'
