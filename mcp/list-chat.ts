/**
 * Reading a list's chat thread over the v1 API (AWTD-963).
 *
 * The repo could WRITE to list chat — `scripts/post-list-message.ts` — and
 * could not read it at all, so a reply to a run summary reached nobody. This
 * is the read half, kept out of `mcp-server-oauth.ts` because that file sits on
 * the oversized-files ratchet (task 9377bc2c) and the same file's history says
 * the answer there is to move a piece out rather than raise the number.
 *
 * Needs the `chat:read` scope. A connection provisioned before chat scopes
 * existed gets a 403 until its scope group is adopted (AWTD-962), so the error
 * says which of the two it is instead of surfacing a bare HTTP code.
 */

/** Just enough of the OAuth client to be testable without one. */
export interface ChatRequester {
  makeRequest<T = unknown>(endpoint: string, options?: RequestInit): Promise<T>
}

export interface ListMessagesQuery {
  listId: string
  limit?: number | string
  before?: string
}

/**
 * Resolve a list's chat channel.
 *
 * Get-or-create, the same call the poster makes. A list nobody has chatted in
 * has no channel row yet, and asking for its messages should answer "none"
 * rather than 404 — so the read path creates the row exactly as the write path
 * would, and the operation stays idempotent either way.
 */
export async function resolveListChannelId(
  client: ChatRequester,
  listId: string,
): Promise<string> {
  const response = await client.makeRequest<{ channel?: { id?: string } }>(
    '/api/v1/chat/channels',
    { method: 'POST', body: JSON.stringify({ listId }) },
  )

  const channelId = response?.channel?.id
  if (!channelId) {
    throw new Error(`Could not resolve a chat channel for list ${listId}`)
  }
  return channelId
}

/** The recent messages in a list's chat, newest page first. */
export async function fetchListMessages(
  client: ChatRequester,
  query: ListMessagesQuery,
): Promise<{ listId: string; channelId: string } & Record<string, unknown>> {
  const channelId = await resolveListChannelId(client, query.listId)

  const params = new URLSearchParams()
  if (query.limit !== undefined) params.append('limit', String(query.limit))
  if (query.before) params.append('before', String(query.before))
  const search = params.toString()

  const page = await client.makeRequest<Record<string, unknown>>(
    `/api/v1/chat/channels/${channelId}/messages${search ? `?${search}` : ''}`,
  )

  return { listId: query.listId, channelId, ...page }
}
