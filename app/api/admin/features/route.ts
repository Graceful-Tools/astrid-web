import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { getUnifiedSession } from '@/lib/session-utils'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { prisma } from '@/lib/prisma'
import { invalidateFeatureFlagCache, FEATURE_KEYS } from '@/lib/feature-flags'
import { broadcastToAll } from '@/lib/sse-utils'

// Was a literal for the single seeded flag; now driven by FEATURE_KEYS so a new
// flag is one edit in lib/feature-flags.ts rather than three scattered ones.
const UpdateSchema = z.object({
  key: z.enum(FEATURE_KEYS),
  enabled: z.boolean(),
  rolloutMode: z.enum(['OFF', 'ALL', 'PERCENTAGE', 'SELECTED_USERS']),
  rolloutPercentage: z.number().int().min(0).max(100),
  includedEmails: z.array(z.string().email()).default([]),
  excludedEmails: z.array(z.string().email()).default([]),
})

async function authorize() {
  const session = await getUnifiedSession()
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
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

export async function GET() {
  const auth = await authorize()
  if (auth.error) return auth.error
  const flags = await prisma.featureFlag.findMany({
    include: {
      targets: {
        orderBy: { createdAt: 'asc' },
      },
      audits: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
    orderBy: { key: 'asc' },
  })
  const userIds = [...new Set(flags.flatMap(flag => flag.targets.map(target => target.userId)))]
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } }, select: { id: true, email: true, name: true },
  }) : []
  const usersById = new Map(users.map(user => [user.id, user]))

  // How many people are waiting on each feature. This is the number that tells
  // an admin which feature to open from the index, so it ships with the list
  // rather than costing one request per feature to render a badge (task
  // 3cef96ef).
  //
  // PENDING only: granted and declined rows stay as the audit trail, so
  // counting every row would show a queue that never empties.
  const pendingByKey = new Map(
    (
      await prisma.featureAccessRequest.groupBy({
        by: ['featureKey'],
        where: { status: 'PENDING' },
        _count: { _all: true },
      })
    ).map(row => [row.featureKey, row._count._all]),
  )

  return NextResponse.json({
    flags: flags.map(flag => ({
      ...flag,
      targets: flag.targets.map(target => ({ ...target, user: usersById.get(target.userId) ?? null })),
      // Always a number, including zero — an absent key would make "no
      // requests" indistinguishable from "the count failed to load".
      pendingRequests: pendingByKey.get(flag.key) ?? 0,
    })),
  })
}

export async function PUT(request: Request) {
  const auth = await authorize()
  if (auth.error || !auth.userId) return auth.error
  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid feature configuration', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data
  const emails = [...new Set([...body.includedEmails, ...body.excludedEmails].map(email => email.toLowerCase()))]
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
  const byEmail = new Map(users.map(user => [user.email.toLowerCase(), user]))
  const missing = emails.filter(email => !byEmail.has(email))
  if (missing.length) return NextResponse.json({ error: `Unknown users: ${missing.join(', ')}` }, { status: 400 })

  const updated = await prisma.$transaction(async tx => {
    const current = await tx.featureFlag.findUnique({ where: { key: body.key }, include: { targets: true } })
    if (!current) throw new Error(`Missing seeded feature flag: ${body.key}`)
    const before = {
      enabled: current.enabled,
      rolloutMode: current.rolloutMode,
      rolloutPercentage: current.rolloutPercentage,
      targets: current.targets.map(target => ({ userId: target.userId, treatment: target.treatment })),
    }
    await tx.featureFlagTarget.deleteMany({ where: { featureFlagId: current.id } })
    const targetTreatments = new Map<string, 'INCLUDE' | 'EXCLUDE'>()
    body.includedEmails.forEach(email => targetTreatments.set(byEmail.get(email.toLowerCase())!.id, 'INCLUDE'))
    // Exclusion wins when an email appears in both fields.
    body.excludedEmails.forEach(email => targetTreatments.set(byEmail.get(email.toLowerCase())!.id, 'EXCLUDE'))
    const targets = [...targetTreatments].map(([userId, treatment]) => ({ userId, treatment }))
    const flag = await tx.featureFlag.update({
      where: { id: current.id },
      data: {
        enabled: body.enabled,
        rolloutMode: body.rolloutMode,
        rolloutPercentage: body.rolloutPercentage,
        version: { increment: 1 },
        updatedByUserId: auth.userId,
        targets: { create: targets.map(target => ({ ...target, createdByUserId: auth.userId })) },
      },
      include: { targets: true },
    })
    await tx.featureFlagAudit.create({
      data: {
        featureFlagId: current.id,
        changedByUserId: auth.userId,
        before: before as Prisma.InputJsonValue,
        after: {
          enabled: flag.enabled,
          rolloutMode: flag.rolloutMode,
          rolloutPercentage: flag.rolloutPercentage,
          targets: flag.targets.map(target => ({ userId: target.userId, treatment: target.treatment })),
        } as Prisma.InputJsonValue,
      },
    })
    return flag
  })
  invalidateFeatureFlagCache()
  await broadcastToAll({ type: 'feature_flags_updated', data: { version: updated.updatedAt.getTime() } })
  return NextResponse.json({ flag: updated })
}
