/**
 * GET/PUT /api/v1/secure-files/[fileId]
 *
 * v1 mount point for the SecureFile fetch/update endpoint. Re-exports the
 * legacy handler — file responses are binary, so there is no `meta`
 * envelope to add.
 */

export { GET, PUT } from '../../../secure-files/[fileId]/route'
