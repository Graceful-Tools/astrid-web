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
import {
  featureRequestRecipient,
  parseFeatureRequest,
  shouldNotifyFeatureRequest,
} from '@/lib/feature-access-requests'
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

    // Whether this reaches a human is its own rule now — see
    // shouldNotifyFeatureRequest. `!existing` silenced far more than the edited
    // note it was aimed at: a declined person re-asking got a thank-you from the
    // dialog and reached nobody, forever (AWTD-882).
    if (shouldNotifyFeatureRequest(existing)) {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { email: true, name: true },
      })

      // Best-effort: a mail failure must not lose the request, which is the
      // durable half of this feature.
      //
      // But it is not swallowed. This catch is the only thing standing between a
      // provider rejection and total silence, and the request row records
      // nothing about whether anyone was told — so if this line is not loud and
      // complete, "did the email go out?" becomes unanswerable after the fact.
      // Diagnosing AWTD-882 meant probing the live transport by hand for exactly
      // that reason. The recipient is logged too: the address is env-overridable
      // (FEATURE_REQUEST_EMAIL), so "sent, but where?" is a real question.
      try {
        await sendFeatureAccessRequestEmail({
          featureKey: parsed.featureKey,
          useCase: parsed.useCase,
          userEmail: user?.email ?? 'unknown',
          userName: user?.name ?? null,
        })
      } catch (error) {
        log.error(
          {
            err: error,
            featureKey: parsed.featureKey,
            recipient: featureRequestRecipient(),
            requesterId: auth.userId,
            reRequestAfter: existing?.status ?? null,
          },
          'Feature request notification FAILED — nobody was told about this request',
        )
      }
    }

    return NextResponse.json({ request }, { status: existing ? 200 : 201 })
  }
)
