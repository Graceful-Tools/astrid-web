import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { requireTaskAccess } from '@/lib/api-auth-middleware'

/** GET /api/v1.sync.google/task-links?listId — the caller's task links for a list. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.google' },
  async (req, auth) => {
    const listId = new URL(req.url).searchParams.get('listId')
    const links = await prisma.externalTaskLink.findMany({
      where: {
        userId: auth.userId,
        provider: 'GOOGLE_TASKS',
        ...(listId ? { task: { lists: { some: { id: listId } } } } : {}),
      },
    })
    return NextResponse.json({ links })
  }
)

/**
 * PUT — upsert a task link after a push/pull.
 * Body: { astridTaskId, remoteId, remoteContainerId, astridUpdatedAt?, remoteUpdatedAt?, metadata? }
 */
export const PUT = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google' },
  async (req, auth) => {
    const body = await req.json()
    const { astridTaskId, remoteId, remoteContainerId } = body || {}
    if (!astridTaskId || !remoteId || !remoteContainerId) {
      return NextResponse.json({ error: 'astridTaskId, remoteId, remoteContainerId required' }, { status: 400 })
    }
    // The link row has an FK to Task — a client-side optimistic temp id would
    // fail the FK deep in Prisma; reject it loudly instead.
    if (typeof astridTaskId !== 'string' || typeof remoteId !== 'string' || typeof remoteContainerId !== 'string') {
      return NextResponse.json({ error: 'Invalid body types' }, { status: 400 })
    }
    // The link row FK-attaches to the task — the caller must actually have
    // access to it (otherwise this is a task-id oracle + foreign-task linker).
    try {
      await requireTaskAccess(auth.userId, astridTaskId)
    } catch {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    if (astridTaskId.startsWith('temp_')) {
      return NextResponse.json({ error: 'astridTaskId is an unsynced temp id — resolve it first' }, { status: 400 })
    }
    const integration = await prisma.integration.findUnique({
      where: { userId_provider: { userId: auth.userId, provider: 'GOOGLE_TASKS' } },
    })
    if (!integration || integration.revokedAt) {
      return NextResponse.json({ error: 'Google not connected' }, { status: 401 })
    }
    // Merge metadata over the existing value: partial upserts (watermark-only
    // pushes, comment-map updates) must not clobber other keys.
    const existingLink = await prisma.externalTaskLink.findUnique({
      where: { userId_astridTaskId_provider: { userId: auth.userId, astridTaskId, provider: 'GOOGLE_TASKS' } },
    })
    const mergedMetadata = body.metadata
      ? { ...(existingLink?.metadata as object || {}), ...body.metadata }
      : undefined

    const link = await prisma.externalTaskLink.upsert({
      where: { userId_astridTaskId_provider: { userId: auth.userId, astridTaskId, provider: 'GOOGLE_TASKS' } },
      create: {
        integrationId: integration.id,
        userId: auth.userId,
        astridTaskId,
        provider: 'GOOGLE_TASKS',
        remoteId,
        remoteContainerId,
        astridUpdatedAt: body.astridUpdatedAt ? new Date(body.astridUpdatedAt) : null,
        remoteUpdatedAt: body.remoteUpdatedAt ? new Date(body.remoteUpdatedAt) : null,
        lastSyncedAt: new Date(),
        metadata: mergedMetadata,
      },
      update: {
        remoteId,
        remoteContainerId,
        astridUpdatedAt: body.astridUpdatedAt ? new Date(body.astridUpdatedAt) : undefined,
        remoteUpdatedAt: body.remoteUpdatedAt ? new Date(body.remoteUpdatedAt) : undefined,
        lastSyncedAt: new Date(),
        metadata: mergedMetadata,
      },
    })
    return NextResponse.json({ link })
  }
)
