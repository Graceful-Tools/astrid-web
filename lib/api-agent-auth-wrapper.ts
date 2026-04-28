import { NextResponse, type NextRequest } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  type AuthContext,
} from './api-auth-middleware'
import { authenticateAgentRequest } from './agent-protocol'
import { createLogger } from './logger'

/**
 * Boilerplate-free auth wrapper for agent route handlers.
 *
 * Same shape as `withAuth` but uses `authenticateAgentRequest` (which
 * validates required scopes and is the canonical auth path for agent/*
 * routes). The wrapper standardizes the 401/403/500 response shape that
 * each agent handler used to hand-roll.
 *
 * @example
 *   export const GET = withAgentAuth(
 *     { requiredScopes: ['tasks:read'], tag: 'v1.agent.tasks' },
 *     async (req, auth) => {
 *       const tasks = await prisma.task.findMany({ where: { assigneeId: auth.userId } })
 *       return NextResponse.json({ tasks })
 *     }
 *   )
 */

interface WithAgentAuthOptions {
  /** Required OAuth scopes; defaults to `['tasks:read']`. */
  requiredScopes?: string[]
  /** Tag for the logger; defaults to "agent.api". */
  tag?: string
}

type Handler<TContext> = (
  req: NextRequest,
  auth: AuthContext,
  context: TContext
) => Promise<NextResponse> | NextResponse

export function withAgentAuth<TContext = unknown>(
  options: WithAgentAuthOptions,
  handler: Handler<TContext>
): (req: NextRequest, context: TContext) => Promise<NextResponse> {
  const log = createLogger(options.tag ?? 'agent.api')
  const requiredScopes = options.requiredScopes ?? ['tasks:read']

  return async (req, context) => {
    let auth: AuthContext
    try {
      auth = await authenticateAgentRequest(req, requiredScopes)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: 'Unauthorized', message: err.message }, { status: 401 })
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 })
      }
      log.error({ err }, 'Agent authentication threw unexpected error')
      return NextResponse.json({ error: 'Authentication error' }, { status: 500 })
    }

    try {
      return await handler(req, auth, context)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: 'Unauthorized', message: err.message }, { status: 401 })
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 })
      }
      log.error({ err, path: req.nextUrl.pathname }, 'Agent handler threw')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
