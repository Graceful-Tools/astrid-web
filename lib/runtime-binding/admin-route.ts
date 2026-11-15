/**
 * Shared plumbing for the admin runtime-binding routes (AWTD-1668).
 *
 * Reads accept any authenticated deployment admin. Changes need a human admin
 * in a browser session: enrolling, approving or attaching a runtime is a
 * consent decision, and an agent's or script's token (even one acting with an
 * admin's permissions) must not be able to make it.
 */
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import { RuntimeBindingEnrollmentError } from '@/lib/runtime-binding/enrollment'

export function refuseUnlessHumanSession(auth: AuthContext): NextResponse | null {
  if (auth.source === 'session' && !auth.isAIAgent && !auth.user.isAIAgent) return null
  return NextResponse.json(
    {
      error: 'Runtime bindings are changed by a signed-in admin in the browser, not with an API token.',
      code: 'session-required',
    },
    { status: 403 },
  )
}

/** A refusal becomes its status and explanation; anything else is rethrown (withAuth answers 500). */
export function enrollmentErrorResponse(thrown: unknown): NextResponse {
  if (thrown instanceof RuntimeBindingEnrollmentError) {
    return NextResponse.json(thrown.toResponseBody(), { status: thrown.status })
  }
  throw thrown
}

/** The JSON body, or null when it is missing or malformed. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function invalidBody(): NextResponse {
  return NextResponse.json({ error: 'The request body must be a JSON object.', code: 'invalid-input' }, { status: 400 })
}

/** An optional expectedRevision: a positive integer, or absent. */
export function expectedRevisionOf(body: Record<string, unknown>): number | undefined | null {
  const value = body.expectedRevision
  if (value === undefined) return undefined
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null
}
