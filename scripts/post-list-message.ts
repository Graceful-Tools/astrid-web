#!/usr/bin/env npx tsx
/**
 * Post a message into a list's Astrid chat.
 *
 * WHY THIS EXISTS. The /fixall run summary used to be a few lines in a
 * terminal nobody reads after the session closes. Per-task detail belongs on
 * the task as a comment and already goes there; the RUN-level news — what was
 * pushed, what was skipped, what failed — now goes where Jon actually looks,
 * which is the list chat on his phone.
 *
 * Usage:
 *   npx tsx scripts/post-list-message.ts <listId> "<markdown>"
 *   echo "<markdown>" | npx tsx scripts/post-list-message.ts <listId> -
 *
 * Must run from the astrid-web root: loadScriptEnv() reads .env.local from
 * process.cwd(). (The fixall session lock is the opposite — it must run from
 * the iOS checkout. Swapping them breaks both.)
 *
 * TWO THINGS THAT WILL BITE YOU:
 *
 * 1. The OAuth client must hold `chat:write`, or POST .../messages 403s. Chat
 *    scopes were missing from OAUTH_SCOPES entirely until this landed, so no
 *    client has them yet and every client-credentials token 403s here today.
 *    The fix is AWTD-951 — agent connections take their scopes from the scope
 *    group they were provisioned from, and existing clients catch up on use.
 *    Deliberately NOT a hand-written UPDATE against the production OAuthClient
 *    row (Jon, 2026-09-16): chat access should be standard for an agent
 *    connection, not granted one row at a time.
 *
 * 2. iOS renders INLINE markdown only (ChatMessageBubble uses
 *    .inlineOnlyPreservingWhitespace). `## headings`, `- bullets` and fenced
 *    code blocks render LITERALLY. Use **bold** labels and • bullets, plain
 *    newlines between lines. `![Title](taskId)` becomes a tappable task link;
 *    `@[Name](userId)` is the only thing that fires a push notification, so
 *    leave mentions out of anything that runs on a schedule.
 */

import { randomUUID } from 'node:crypto'
import { loadScriptEnv } from './lib/load-env'
import { resolveAgentAuthorId } from './lib/agent-author'

loadScriptEnv()

const API = 'https://astrid.cc'

async function mintToken(): Promise<string> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET are required')
  }

  const response = await fetch(`${API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`OAuth token request failed with HTTP ${response.status}`)
  }

  const { access_token: token } = await response.json()
  return token
}

/** Get-or-create the list's chat channel. Upserts on listId, so it is idempotent. */
async function resolveChannelId(token: string, listId: string): Promise<string> {
  const response = await fetch(`${API}/api/v1/chat/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OAuth-Token': token },
    body: JSON.stringify({ listId }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Could not resolve chat channel for list ${listId} — HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  const { channel } = await response.json()
  if (!channel?.id) throw new Error('Chat channel response carried no id')
  return channel.id
}

async function readContent(arg: string): Promise<string> {
  if (arg !== '-') return arg
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const [listId, contentArg] = process.argv.slice(2)

  if (!listId || contentArg === undefined) {
    console.error('Usage: npx tsx scripts/post-list-message.ts <listId> "<markdown>"')
    console.error('       ... <listId> -      # read the message from stdin')
    process.exit(1)
  }

  const content = (await readContent(contentArg)).trim()
  if (!content) {
    console.error('RESULT: FAILED — refusing to post an empty message')
    process.exit(1)
  }

  const token = await mintToken()
  const channelId = await resolveChannelId(token, listId)
  const aiAgentId = await resolveAgentAuthorId({ mailbox: 'claude', accessToken: token })

  const response = await fetch(`${API}/api/v1/chat/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OAuth-Token': token },
    body: JSON.stringify({
      content,
      type: 'MARKDOWN',
      // Unique column server-side: a retried post returns the existing message
      // instead of doubling it in the channel.
      clientRequestId: randomUUID(),
      // Sign as the coding agent rather than the OAuth client's owner, so the
      // summary does not read as Jon talking to himself (AWTD-878's rule,
      // extended to chat). Unresolvable, the field is omitted and the server
      // falls back to the token owner rather than failing.
      ...(aiAgentId ? { aiAgentId } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 403) {
      console.error(
        'RESULT: FAILED — 403 on the chat route. The OAuth client is missing ' +
        'chat:write, which no client can hold until AWTD-951 lands.'
      )
      process.exit(1)
    }
    console.error(`RESULT: FAILED — HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    process.exit(1)
  }

  const { message } = await response.json()
  console.log(`RESULT: OK — posted to list ${listId} as ${message?.author?.name || 'unknown'} (${message?.id})`)
}

main().catch(error => {
  console.error(`RESULT: FAILED — ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
