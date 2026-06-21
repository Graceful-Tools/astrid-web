/**
 * Shortcodes API v1 — resolve by code
 *
 * GET /api/v1/shortcodes/[code] - Resolve a shortcode to its target task or list
 *
 * Mirrors the legacy `GET /api/shortcodes/[code]` so the iOS client can stay on
 * v1 paths (see iOS V1APIContractIntegrationTests). The legacy public route is
 * left in place for unauthenticated web shared-link resolution; this v1 variant
 * is authenticated like the rest of the v1 surface.
 */

import { NextResponse } from 'next/server'
import { resolveShortcode } from '@/lib/shortcode'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ code: string }> }

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.shortcodes.[code]' },
  async (_req, auth, { params }) => {
    const { code } = await params

    if (!code) {
      return NextResponse.json(
        { error: 'Validation error', message: 'Code is required', meta: { apiVersion: 'v1', authSource: auth.source } },
        { status: 400 }
      )
    }

    const result = await resolveShortcode(code)

    if (!result) {
      return NextResponse.json(
        { error: 'Not found', message: 'Shortcode not found or expired', meta: { apiVersion: 'v1', authSource: auth.source } },
        { status: 404 }
      )
    }

    return NextResponse.json({ ...result, meta: { apiVersion: 'v1', authSource: auth.source } })
  }
)
