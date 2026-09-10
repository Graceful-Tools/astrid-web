/**
 * PATCH/DELETE /api/v1/users/me/passkeys/:id — rename or revoke one (AWTD-885)
 *
 * **The id is the path, once.** The unversioned route takes it from the query
 * string on DELETE and from the request body on PATCH — two spellings of the
 * same thing on one endpoint, which every client then has to remember.
 *
 * **A passkey that is not yours is 404, not 403.** `renamePasskey` and
 * `deletePasskey` scope their lookup by `userId`, so "not yours" and "not
 * there" are already the same answer — and should be. A 403 would confirm that
 * someone else's passkey id exists.
 *
 * Listing is on the collection route; registering stays in the browser, under
 * `/api/auth/webauthn/**`, because the WebAuthn ceremony needs a user gesture.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { deletePasskey, renamePasskey } from '@/lib/webauthn'
import type { AuthContext } from '@/lib/api-auth-middleware'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function ok(auth: AuthContext) {
  const headers: Record<string, string> = {}
  const deprecationWarning = getDeprecationWarning(auth)
  if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

  return NextResponse.json(
    { success: true, meta: { apiVersion: 'v1', authSource: auth.source } },
    { headers },
  )
}

export const PATCH = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.users.me.passkeys.id', capability: 'authPasskey' },
  async (request, auth, { params }) => {
    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      // Whitespace counts as empty: a passkey named "   " is one the user
      // cannot tell apart from any other in the list.
      return NextResponse.json({ error: 'A name is required' }, { status: 400 })
    }

    const result = await renamePasskey(auth.userId, id, name)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return ok(auth)
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.users.me.passkeys.id', capability: 'authPasskey' },
  async (_request, auth, { params }) => {
    const { id } = await params

    const result = await deletePasskey(auth.userId, id)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return ok(auth)
  },
)
