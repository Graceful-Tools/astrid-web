/**
 * GET /api/v1/users/me/passkeys — the account's passkeys (AWTD-885)
 *
 * Managing passkeys had only the unversioned `/api/auth/webauthn/passkeys`, so
 * a native client that speaks `/api/v1/...` over an OAuth token could not reach
 * them at all.
 *
 * **Registering one is deliberately not here.** The WebAuthn ceremony needs a
 * real user gesture against `rpID`, which is why the register/authenticate
 * routes stay under `/api/auth/webauthn/**` and are exempt from the legacy
 * census (task 641a7615, decision 2). Listing, renaming and revoking are plain
 * CRUD over rows the account already owns, and nothing about them is
 * browser-shaped.
 *
 * Rename and revoke live at `/api/v1/users/me/passkeys/[id]`.
 *
 * The `authPasskey` capability gate comes from the wrapper: a deployment with
 * passkeys switched off answers 404 here rather than an empty list.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { getUserPasskeys } from '@/lib/webauthn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.passkeys', capability: 'authPasskey' },
  async (_request, auth) => {
    // The user is the authenticated one, never a caller-supplied id.
    const passkeys = await getUserPasskeys(auth.userId)

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      { passkeys, meta: { apiVersion: 'v1', authSource: auth.source } },
      { headers },
    )
  },
)
