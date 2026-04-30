/**
 * POST /api/v1/secure-files/[fileId]/upload-url
 *
 * v1 mount point for the SecureFile upload chain step 3 (mint a signed
 * upload URL for an existing file record). Re-exports the legacy handler.
 */

export { POST } from '../../../../secure-files/[fileId]/upload-url/route'
