/**
 * POST /api/v1/chat/channels
 *
 * Get-or-create a chat channel for a list (`listId`) or virtual key
 * (`virtualKey`). Re-exports the legacy handler so iOS can migrate off the
 * legacy `/api/*` surface without a behavior change.
 */

export { POST } from '../../../chat/channels/route'
