/**
 * POST /api/v1/secure-upload/get-upload-url
 *
 * v1 mount point for the SecureFile upload chain step 2 (Vercel Blob client
 * token mint). Re-exports the legacy handler — same behavior, same
 * client-token signing.
 */

export { POST } from '../../../secure-upload/get-upload-url/route'
