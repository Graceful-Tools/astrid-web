import { hasCapability, type CapabilityKey } from '@/lib/brand/capabilities'
import { hasRequiredScopes } from '@/lib/oauth/oauth-scopes'
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
  /**
   * Called (instead of the default warning log) when an access-token caller
   * passes today's '*' check but would fail the scopes its permissions map to.
   * Tests inject it; production leaves it unset.
   */
  onShadowDenied?: (info: ShadowDenied) => void
}

export interface ShadowDenied {
  tag?: string
  path: string
  needed: string[]
  shadowScopes: string[]
}

type Handler<TContext> = (
  req: NextRequest,
  auth: AuthContext,
  context: TContext
) => Promise<NextResponse> | NextResponse

/**
 * The context argument is required only for a route that declares one.
 *
 * Next.js always passes a second argument, so `(req, context)` was faithful to
 * the framework — but for a route with no dynamic segment `TContext` stays at
 * its `unknown` default, and the signature then demanded an argument that the
 * handler cannot read without a cast and that no caller has anything to put in.
 * Every direct caller — 136 call sites across the test tree (AWTD-916) — had to
 * invent one.
 *
 * So: optional when `TContext` is left unspecified, required the moment a route
 * names its params. `unknown extends TContext` is true only for the default,
 * which is what makes that distinction. A param route still cannot be called
 * without its params.
 */
type ContextArg<TContext> = unknown extends TContext
  ? [context?: TContext]
  : [context: TContext]

export function withAuth<TContext = unknown>(
  options: WithAuthOptions,
  handler: Handler<TContext>
): (req: NextRequest, ...args: ContextArg<TContext>) => Promise<NextResponse> {
  const log = createLogger(options.tag ?? 'api')

  // Resolved once at module load: capabilities are build-time constants, so this costs
  // nothing per request and a disabled route short-circuits before authentication —
  // strictly less work than the previous path, never more.
  const capabilityDisabled = options.capability ? !hasCapability(options.capability) : false

  return async (req: NextRequest, ...args: ContextArg<TContext>) => {
    // `args[0]` is the context Next.js passed, or undefined for a route that
    // declares none — in which case TContext is `unknown` and the handler
    // cannot read it anyway.
    const context = args[0] as TContext

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

      // Shadow enforcement for access tokens: they pass on '*' today. Log what
      // real scopes would have refused, so the switch is made on evidence.
      if (
        auth.source === 'legacy_mcp' &&
        auth.shadowScopes &&
        !hasRequiredScopes(auth.shadowScopes, options.scopes)
      ) {
        const info: ShadowDenied = {
          tag: options.tag,
          path: req.nextUrl.pathname,
          needed: options.scopes,
          shadowScopes: auth.shadowScopes,
        }
        if (options.onShadowDenied) options.onShadowDenied(info)
        else log.warn(info, 'access token would be denied under scope mapping')
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
