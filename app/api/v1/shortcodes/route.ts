/**
 * Shortcodes API v1
 *
 * POST /api/v1/shortcodes - Create shortcode for sharing
 * GET  /api/v1/shortcodes - Get shortcodes for a target
 *
 * The access rule lives in lib/shortcode-target-access.ts and is shared with
 * the legacy route, where it had been copy-pasted between POST and GET.
 * (Task e0613ae5.)
 *
 * Unlike legacy, this route builds share URLs from the configured base URL
 * rather than the request's Host header — an OAuth client's Host is not a
 * signal about where the link should point.
 */

import { NextResponse } from 'next/server'
import { createShortcode, getShortcodesForTarget, buildShortcodeUrl } from '@/lib/shortcode'
import {
  checkShortcodeTargetAccess,
  type ShortcodeTargetAccess,
  type ShortcodeTargetType,
} from '@/lib/shortcode-target-access'
import { withAuth } from '@/lib/api-auth-wrapper'

function denied(result: Extract<ShortcodeTargetAccess, { ok: false }>, authSource: string) {
  return NextResponse.json(
    {
      error: result.error,
      message: result.message,
      meta: { apiVersion: 'v1', authSource },
    },
    { status: result.status }
  )
}

/**
 * POST /api/v1/shortcodes
 * Create a new shortcode for a task or list
 *
 * Body:
 * - targetType: "task" | "list"
 * - targetId: string (UUID)
 * - expiresAt?: string (ISO date, optional)
 */
export const POST = withAuth(
  // Require at least tasks:read to create share links
  { scopes: ['tasks:read'], tag: 'v1.shortcodes' },
  async (req, auth) => {
    const body = await req.json()
    const { targetType, targetId, expiresAt } = body

    const access = await checkShortcodeTargetAccess(targetType, targetId, auth.userId)
    if (!access.ok) return denied(access, auth.source)

    const shortcode = await createShortcode({
      targetType: targetType as ShortcodeTargetType,
      targetId,
      userId: auth.userId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    })

    return NextResponse.json({
      shortcode,
      url: buildShortcodeUrl(shortcode.code),
      meta: { apiVersion: 'v1', authSource: auth.source }
    })
  }
)

/**
 * GET /api/v1/shortcodes?targetType=task&targetId=xxx
 * Get all shortcodes for a target
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.shortcodes' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const targetType = searchParams.get('targetType')
    const targetId = searchParams.get('targetId')

    const access = await checkShortcodeTargetAccess(targetType, targetId, auth.userId)
    if (!access.ok) return denied(access, auth.source)

    const shortcodes = await getShortcodesForTarget(
      targetType as ShortcodeTargetType,
      targetId as string
    )

    return NextResponse.json({
      shortcodes: shortcodes.map((sc) => ({
        ...sc,
        url: buildShortcodeUrl(sc.code)
      })),
      meta: {
        apiVersion: 'v1',
        authSource: auth.source,
        count: shortcodes.length
      }
    })
  }
)
