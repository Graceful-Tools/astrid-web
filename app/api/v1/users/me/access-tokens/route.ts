/**
 * POST /api/v1/users/me/access-tokens — mint a user-level access token
 *
 * The v1 twin of POST /api/mcp/user-tokens (AWTD-1312): same body, same
 * token, so the native clients can offer "Use Astrid in GitHub Copilot"
 * without reaching outside /api/v1. List and revoke it through
 * /api/v1/users/me/connections (kind `accessToken`).
 *
 * Session-only, like OAuth client registration and connection revoke. A
 * delegated token that could mint a long-lived bearer would let one leaked
 * credential outlive its own revocation — and a narrow token mint a broad one.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuth } from '@/lib/api-auth-wrapper'
import { MintAccessTokenSchema, mintAccessToken } from '@/lib/connections/mint-access-token'
import type { V1AccessTokenCreateResponse } from '@/lib/api-contracts/v1-ios-shapes'

export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.access-tokens', capability: 'integrationMcp' },
  async (req, auth) => {
    if (auth.source !== 'session') {
      return NextResponse.json(
        { error: 'Creating an access token requires an interactive session' },
        { status: 403 }
      )
    }

    let input
    try {
      input = MintAccessTokenSchema.parse(await req.json())
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: error.errors },
          { status: 400 }
        )
      }
      throw error
    }

    const minted = await mintAccessToken(auth.userId, input)
    if (!minted.ok) {
      return NextResponse.json({ error: minted.error }, { status: minted.status })
    }

    const body: V1AccessTokenCreateResponse = {
      success: true,
      token: minted.token,
      permissions: minted.permissions,
      expiresAt: minted.expiresAt?.toISOString() ?? null,
      description: minted.description,
      createdAt: minted.createdAt.toISOString(),
      meta: { apiVersion: 'v1', authSource: auth.source },
    }
    return NextResponse.json(body)
  }
)
