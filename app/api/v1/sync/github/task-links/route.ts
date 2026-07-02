import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'

/** GET /api/v1/sync/github/task-links?listId — the caller's task links for a list. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const listId = new URL(req.url).searchParams.get('listId')
    const links = await prisma.externalTaskLink.findMany({
      where: {
        userId: auth.userId,
        provider: 'GITHUB_ISSUES',
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
  { scopes: ['tasks:write'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const body = await req.json()
    const { astridTaskId, remoteId, remoteContainerId } = body || {}
    if (!astridTaskId || !remoteId || !remoteContainerId) {
      return NextResponse.json({ error: 'astridTaskId, remoteId, remoteContainerId required' }, { status: 400 })
    }
    const integration = await prisma.integration.findUnique({
      where: { userId_provider: { userId: auth.userId, provider: 'GITHUB_ISSUES' } },
    })
    if (!integration || integration.revokedAt) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }
    const link = await prisma.externalTaskLink.upsert({
      where: { userId_astridTaskId_provider: { userId: auth.userId, astridTaskId, provider: 'GITHUB_ISSUES' } },
      create: {
        integrationId: integration.id,
        userId: auth.userId,
        astridTaskId,
        provider: 'GITHUB_ISSUES',
        remoteId,
        remoteContainerId,
        astridUpdatedAt: body.astridUpdatedAt ? new Date(body.astridUpdatedAt) : null,
        remoteUpdatedAt: body.remoteUpdatedAt ? new Date(body.remoteUpdatedAt) : null,
        lastSyncedAt: new Date(),
        metadata: body.metadata ?? undefined,
      },
      update: {
        remoteId,
        remoteContainerId,
        astridUpdatedAt: body.astridUpdatedAt ? new Date(body.astridUpdatedAt) : undefined,
        remoteUpdatedAt: body.remoteUpdatedAt ? new Date(body.remoteUpdatedAt) : undefined,
        lastSyncedAt: new Date(),
        metadata: body.metadata ?? undefined,
      },
    })
    return NextResponse.json({ link })
  }
)
