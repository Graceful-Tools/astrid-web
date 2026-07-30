import { hasCapability, type CapabilityKey } from '@/lib/brand/capabilities'
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
  /**
   * Build-time capability this route belongs to. When the deployment has it disabled
   * the route answers 404 and never reaches the handler. See lib/brand/capabilities.ts.
   *
   * 404 rather than 403 on purpose: a disabled capability does not exist in this
   * deployment, and saying "forbidden" would confirm the endpoint is there and hint
   * that some other caller could reach it.
   */
  capability?: CapabilityKey
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

  // Resolved once at module load: capabilities are build-time constants, so this costs
  // nothing per request and a disabled route short-circuits before authentication —
  // strictly less work than the previous path, never more.
  const capabilityDisabled = options.capability ? !hasCapability(options.capability) : false

  return async (req, context) => {
    if (capabilityDisabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

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
