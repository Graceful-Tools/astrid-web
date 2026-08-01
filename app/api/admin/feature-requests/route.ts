/**
 * Admin view of the feature-request queue (task dd7172d8).
 *
 * GET  /api/admin/feature-requests?featureKey=project_mode — queue + demand counts
 * PUT  /api/admin/feature-requests — grant or decline one request
 *
 * Granting deliberately does two things in one transaction: it marks the
 * request GRANTED *and* adds the user as an INCLUDE target on the feature flag.
 * Splitting those would let the queue and the flag disagree, which is how an
 * admin ends up telling someone "you have access" when they don't.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getUnifiedSession } from '@/lib/session-utils'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { invalidateFeatureFlagCache } from '@/lib/feature-flags'
import { broadcastToAll } from '@/lib/sse-utils'
import { createLogger } from '@/lib/logger'
import { parseFeatureRequest, summarizeFeatureDemand } from '@/lib/feature-access-requests'

const log = createLogger('admin.feature-requests')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ReviewSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['GRANTED', 'DECLINED']),
})

async function authorize() {
  const session = await getUnifiedSession()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  try {
    await requireAdmin(session.user.id)
    return { userId: session.user.id }
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return { error: NextResponse.json({ error: error.message }, { status: 403 }) }
    }
    throw error
  }
}

export async function GET(request: Request) {
  const auth = await authorize()
  if (auth.error) return auth.error

  const featureKey = new URL(request.url).searchParams.get('featureKey') || 'project_mode'
  const parsed = parseFeatureRequest({ featureKey })
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const rows = await prisma.featureAccessRequest.findMany({
    where: { featureKey: parsed.featureKey },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { user: { select: { id: true, email: true, name: true, image: true } } },
  })

  return NextResponse.json({
    featureKey: parsed.featureKey,
    demand: summarizeFeatureDemand(rows),
    requests: rows,
  })
}

export async function PUT(request: Request) {
  const auth = await authorize()
  if (auth.error || !auth.userId) return auth.error

  const parsed = ReviewSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid review', details: parsed.error.flatten() }, { status: 400 })
  }
  const { requestId, decision } = parsed.data

  const existing = await prisma.featureAccessRequest.findUnique({
    where: { id: requestId },
    select: { id: true, userId: true, featureKey: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  const updated = await prisma.$transaction(async tx => {
    const review = await tx.featureAccessRequest.update({
      where: { id: requestId },
      data: { status: decision, reviewedAt: new Date(), reviewedBy: auth.userId },
      include: { user: { select: { id: true, email: true, name: true, image: true } } },
    })

    const flag = await tx.featureFlag.findUnique({
      where: { key: existing.featureKey },
      select: { id: true },
    })
    if (!flag) {
      // The flag row is seeded by migration; if it is missing the grant cannot
      // take effect and silently "succeeding" would be a lie to the admin.
      throw new Error(`Missing seeded feature flag: ${existing.featureKey}`)
    }

    if (decision === 'GRANTED') {
      await tx.featureFlagTarget.upsert({
        where: { featureFlagId_userId: { featureFlagId: flag.id, userId: existing.userId } },
        create: {
          featureFlagId: flag.id,
          userId: existing.userId,
          treatment: 'INCLUDE',
          createdByUserId: auth.userId,
        },
        update: { treatment: 'INCLUDE', createdByUserId: auth.userId },
      })
    } else {
      // Declining removes any INCLUDE we previously granted, so "decline" after
      // "grant" actually revokes rather than leaving stale access behind.
      await tx.featureFlagTarget.deleteMany({
        where: { featureFlagId: flag.id, userId: existing.userId, treatment: 'INCLUDE' },
      })
    }

    return review
  })

  invalidateFeatureFlagCache()
  await broadcastToAll({ type: 'feature_flags_updated', data: { version: Date.now() } }).catch(error => {
    log.error({ err: error }, 'Failed to broadcast feature flag update after review')
  })

  return NextResponse.json({ request: updated })
}
