/**
 * POST /api/v1/users/me/access-tokens/:id/rotate — replace an access token's
 * secret (AWTD-1567).
 *
 * The new token keeps the old one's permissions, explicit scopes (or none),
 * agent binding, description and lifetime; the old one is revoked in the same
 * transaction. The plaintext is returned once, here.
 *
 * Session-only, like minting and revoking: a token that could rotate itself
 * would let a leaked credential lock its owner out and keep the access.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { rotateAccessToken } from '@/lib/connections/rotate-access-token'
import type { V1AccessTokenRotateResponse } from '@/lib/api-contracts/v1-ios-shapes'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.users.me.access-tokens.rotate', capability: 'integrationMcp' },
  async (_req, auth, { params }) => {
    if (auth.source !== 'session') {
      return NextResponse.json(
        { error: 'Rotating an access token requires an interactive session' },
        { status: 403 }
      )
    }

    const { id } = await params
    const rotated = await rotateAccessToken(auth.userId, id)
    if (!rotated.ok) {
      return NextResponse.json({ error: rotated.error }, { status: rotated.status })
    }

    const body: V1AccessTokenRotateResponse = {
      success: true,
      id: rotated.id,
      replacedId: rotated.replacedId,
      token: rotated.token,
      permissions: rotated.permissions,
      scopes: rotated.scopes,
      expiresAt: rotated.expiresAt?.toISOString() ?? null,
      description: rotated.description,
      createdAt: rotated.createdAt.toISOString(),
      meta: { apiVersion: 'v1', authSource: auth.source },
    }
    return NextResponse.json(body)
  }
)
