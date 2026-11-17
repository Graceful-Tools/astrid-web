/**
 * GET /api/v1/agent-queue?agent=claude — what a polling harness may work right now,
 * and what has been said to it that it has not answered.
 *
 * The one call a loop makes. `/loop 30m /fixall` in Claude Code, a cron'd
 * `codex exec`, a scheduled GitHub Actions job: each wakes up, asks this endpoint
 * what is queued for its agent identity, works it, and goes back to sleep. Nothing
 * is pushed to the harness and no provider is called from here, so a quiet day
 * costs exactly one HTTP request.
 *
 * The queue rules — Ready, assigned to this identity (or, with
 * `includeUnassigned`, unassigned on the named board), past its start date, and
 * visible to the caller — live in lib/agent-queue.ts. This file is the HTTP shell.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { BadQueueOptionError, buildAgentQueue, UnknownAgentError } from '@/lib/agent-queue'
import { RuntimeBindingDeniedError } from '@/lib/ai/runtime-binding-resolver'
import { hasRequiredScopes } from '@/lib/oauth/oauth-scopes'
import { createLogger } from '@/lib/logger'
import { recordAgentQueueCheck } from '@/services/agent-presence.service'
import { runtimePrincipalOf } from '@/lib/runtime-binding/task-runtime'
import { runtimeBindingDenialResponse } from '@/lib/runtime-binding/denial-response'

const log = createLogger('v1.agent-queue')

class BadQueueParameterError extends Error {}

/**
 * `?requireReady=false` — queue unstatused tasks too, for someone who does not use
 * the board (AWTD-871). Absent means the default rule, so no existing caller moves.
 *
 * A misspelling is REJECTED rather than read as `true`. `?requireReady=no` silently
 * meaning "yes" would answer `empty: true` on every poll of a queue the caller has
 * just tried to open, and hand them the one failure a scheduled loop cannot debug —
 * exactly the silence the rest of this endpoint is written against.
 */
function parseBooleanParam(name: string, raw: string | null, absent: boolean): boolean {
  if (raw === null) return absent
  const value = raw.trim().toLowerCase()
  if (value === 'false' || value === '0') return false
  if (value === 'true' || value === '1' || value === '') return true
  throw new BadQueueParameterError(
    `${name} must be true or false, not "${raw}".`
  )
}

export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.agent-queue' },
  async (req, auth) => {
    try {
      const url = new URL(req.url)

      const result = await buildAgentQueue({
        agent: url.searchParams.get('agent'),
        userId: auth.userId,
        listId: url.searchParams.get('listId'),
        requireReady: parseBooleanParam('requireReady', url.searchParams.get('requireReady'), true),
        // `?includeUnassigned=true` — unassigned Ready tasks on the named board
        // queue too. Opt-in; lib/agent-queue.ts says why and what bounds it.
        includeUnassigned: parseBooleanParam(
          'includeUnassigned',
          url.searchParams.get('includeUnassigned'),
          false
        ),
        // The chat half of the inbox is included only if the caller ALREADY
        // holds chat:read (AWTD-963). Adding it to this route's `scopes` would
        // 403 the whole queue for every token minted before chat scopes
        // existed — which today is all of them — and stop every loop dead,
        // including the task-comment half that needs nothing new. Asking
        // instead means the chat half turns itself on with the first token
        // that carries the scope, and nothing has to be deployed twice.
        // hasRequiredScopes honours the wildcard, so session auth gets it.
        includeChat: hasRequiredScopes(auth.scopes ?? [], ['chat:read']),
        // Only the runtime-binding pilot reads it (AWTD-1669): a bound board's
        // work is discoverable solely by its binding's enrolled OAuth client.
        runtimePrincipal: runtimePrincipalOf(auth),
      })

      // The queue check is the agent's sign of life on each board it named or
      // was handed work from (AWTD-1697).
      const listIds = new Set<string>(result.queue.flatMap(task => (task.listId ? [task.listId] : [])))
      const named = url.searchParams.get('listId')
      if (named) listIds.add(named)
      if (result.agent.id) {
        await recordAgentQueueCheck({ agentId: result.agent.id, userId: auth.userId, listIds: [...listIds] })
      }

      return NextResponse.json({
        ...result,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof BadQueueParameterError || error instanceof BadQueueOptionError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof UnknownAgentError) {
        return NextResponse.json({ error: error.message, hint: error.hint }, { status: 400 })
      }
      // A board whose explicit runtime binding cannot be used (AWTD-1667). Its
      // own status, with a machine-readable reason, so a loop stops and says
      // why rather than reading an empty queue as a quiet day.
      if (error instanceof RuntimeBindingDeniedError) return runtimeBindingDenialResponse(error)
      log.error({ err: error }, 'Error building agent queue')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
