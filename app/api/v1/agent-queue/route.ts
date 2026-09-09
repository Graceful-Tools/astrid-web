/**
 * GET /api/v1/agent-queue?agent=claude — what a polling harness may work right now.
 *
 * The one call a loop makes. `/loop 30m /fixall` in Claude Code, a cron'd
 * `codex exec`, a scheduled GitHub Actions job: each wakes up, asks this endpoint
 * what is queued for its agent identity, works it, and goes back to sleep. Nothing
 * is pushed to the harness and no provider is called from here, so a quiet day
 * costs exactly one HTTP request.
 *
 * The queue rules — Ready, assigned to this identity, past its start date, and
 * visible to the caller — live in lib/agent-queue.ts. This file is the HTTP shell.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { buildAgentQueue, UnknownAgentError } from '@/lib/agent-queue'
import { createLogger } from '@/lib/logger'

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
function parseRequireReady(raw: string | null): boolean {
  if (raw === null) return true
  const value = raw.trim().toLowerCase()
  if (value === 'false' || value === '0') return false
  if (value === 'true' || value === '1' || value === '') return true
  throw new BadQueueParameterError(
    `requireReady must be true or false, not "${raw}".`
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
        requireReady: parseRequireReady(url.searchParams.get('requireReady')),
      })

      return NextResponse.json({
        ...result,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof BadQueueParameterError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof UnknownAgentError) {
        return NextResponse.json({ error: error.message, hint: error.hint }, { status: 400 })
      }
      log.error({ err: error }, 'Error building agent queue')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
