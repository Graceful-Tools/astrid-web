/**
 * Feature access requests (task dd7172d8).
 *
 * GET  /api/v1/feature-requests?featureKey=project_mode — the caller's own request, if any
 * POST /api/v1/feature-requests — ask for access to a gated feature
 *
 * The POST is an upsert keyed on (userId, featureKey): asking twice updates the
 * note rather than creating a second row, so the demand count stays a count of
 * *people*, not of clicks.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { parseFeatureRequest } from '@/lib/feature-access-requests'
import { sendFeatureAccessRequestEmail } from '@/lib/email'

const log = createLogger('v1.feature-requests')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.feature-requests' },
  async (req, auth) => {
    const featureKey = new URL(req.url).searchParams.get('featureKey') || ''
    const parsed = parseFeatureRequest({ featureKey })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const request = await prisma.featureAccessRequest.findUnique({
      where: { userId_featureKey: { userId: auth.userId, featureKey: parsed.featureKey } },
      select: { status: true, useCase: true, createdAt: true, grandfathered: true },
    })

    return NextResponse.json({ request })
  }
)

export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.feature-requests' },
  async (req, auth) => {
    const body = await req.json().catch(() => ({}))
    const parsed = parseFeatureRequest(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const existing = await prisma.featureAccessRequest.findUnique({
      where: { userId_featureKey: { userId: auth.userId, featureKey: parsed.featureKey } },
      select: { id: true, status: true },
    })

    // Re-requesting refreshes the note but must not resurrect a decision an
    // admin already made — a DECLINED row stays declined until they change it.
    const request = await prisma.featureAccessRequest.upsert({
      where: { userId_featureKey: { userId: auth.userId, featureKey: parsed.featureKey } },
      create: { userId: auth.userId, featureKey: parsed.featureKey, useCase: parsed.useCase },
      update: { useCase: parsed.useCase },
      select: { id: true, status: true, useCase: true, createdAt: true },
    })

    // Only notify on a genuinely new request. An edited note is not worth an email.
    if (!existing) {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { email: true, name: true },
      })

      // Best-effort: a mail failure must not lose the request, which is the
      // durable half of this feature.
      try {
        await sendFeatureAccessRequestEmail({
          featureKey: parsed.featureKey,
          useCase: parsed.useCase,
          userEmail: user?.email ?? 'unknown',
          userName: user?.name ?? null,
        })
      } catch (error) {
        log.error({ err: error, featureKey: parsed.featureKey }, 'Feature request email failed')
      }
    }

    return NextResponse.json({ request }, { status: existing ? 200 : 201 })
  }
)
