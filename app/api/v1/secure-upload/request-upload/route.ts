/**
 * POST /api/v1/secure-upload/request-upload
 *
 * v1 mount point for the SecureFile upload chain step 1. Re-exports the
 * legacy `/api/secure-upload/request-upload` handler unchanged so iOS can
 * migrate off the legacy `/api/*` surface without a behavior change.
 */

export { POST } from '../../../secure-upload/request-upload/route'
