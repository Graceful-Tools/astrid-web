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

export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.agent-queue' },
  async (req, auth) => {
    try {
      const url = new URL(req.url)

      const result = await buildAgentQueue({
        agent: url.searchParams.get('agent'),
        userId: auth.userId,
        listId: url.searchParams.get('listId'),
      })

      return NextResponse.json({
        ...result,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof UnknownAgentError) {
        return NextResponse.json({ error: error.message, hint: error.hint }, { status: 400 })
      }
      log.error({ err: error }, 'Error building agent queue')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
