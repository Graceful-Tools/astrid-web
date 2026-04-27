import { NextResponse, type NextRequest } from 'next/server'
import {
  authenticateAPI,
  requireScopes,
  ForbiddenError,
  UnauthorizedError,
  type AuthContext,
} from './api-auth-middleware'
import { createLogger } from './logger'

/**
 * Boilerplate-free auth wrapper for route handlers.
 *
 * Replaces the ~10-line try/catch + scope-check + 401/403 dance that's
 * copy-pasted across ~200 routes today. Routes get a typed `auth: AuthContext`
 * and only need to write the actual business logic.
 *
 * The underlying primitives (`authenticateAPI`, `requireScopes`,
 * `UnauthorizedError`, `ForbiddenError`) are unchanged — this is purely a
 * call-site simplification, not an auth flow change.
 *
 * @example
 *   export const GET = withAuth(
 *     { scopes: ['tasks:read'] },
 *     async (req, auth) => {
 *       const tasks = await prisma.task.findMany({ where: { userId: auth.userId } })
 *       return NextResponse.json({ tasks })
 *     }
 *   )
 *
 * For dynamic routes, the second argument is the Next.js route context:
 *
 * @example
 *   export const GET = withAuth(
 *     { scopes: ['tasks:read'] },
 *     async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
 *       const { id } = await ctx.params
 *       ...
 *     }
 *   )
 */

interface WithAuthOptions {
  /** Required OAuth scopes. Empty array (default) allows any authenticated caller. */
  scopes?: string[]
  /** Tag for the logger; defaults to "api". */
  tag?: string
}

type Handler<TContext> = (
  req: NextRequest,
  auth: AuthContext,
  context: TContext
) => Promise<NextResponse> | NextResponse

export function withAuth<TContext = unknown>(
  options: WithAuthOptions,
  handler: Handler<TContext>
): (req: NextRequest, context: TContext) => Promise<NextResponse> {
  const log = createLogger(options.tag ?? 'api')

  return async (req, context) => {
    let auth: AuthContext
    try {
      auth = await authenticateAPI(req)
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: 'Unauthorized', message: err.message }, { status: 401 })
      }
      log.error({ err }, 'Authentication threw unexpected error')
      return NextResponse.json({ error: 'Authentication error' }, { status: 500 })
    }

    if (options.scopes && options.scopes.length > 0) {
      try {
        requireScopes(auth, options.scopes)
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return NextResponse.json({ error: 'Forbidden', message: err.message }, { status: 403 })
        }
        throw err
      }
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
      log.error({ err, path: req.nextUrl.pathname }, 'Handler threw')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
