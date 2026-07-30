import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { requireTaskAccess } from '@/lib/api-auth-middleware'

/** GET /api/v1/sync/github/task-links?listId — the caller's task links for a list. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
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
 * DELETE — detach one exact task/issue link.
 *
 * This is intentionally additive to v1: existing GET and PUT clients keep
 * their original contract, while newer clients can persist transfer/removal
 * handling without deleting another device's replacement link.
 */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const params = new URL(req.url).searchParams
    const astridTaskId = params.get('astridTaskId')
    const remoteId = params.get('remoteId')
    if (!astridTaskId || !remoteId) {
      return NextResponse.json({ error: 'astridTaskId and remoteId required' }, { status: 400 })
    }

    const result = await prisma.externalTaskLink.deleteMany({
      where: {
        userId: auth.userId,
        provider: 'GITHUB_ISSUES',
        astridTaskId,
        remoteId,
      },
    })

    return NextResponse.json({ success: true, detached: result.count > 0 })
  }
)

/**
 * PUT — upsert a task link after a push/pull.
 * Body: { astridTaskId, remoteId, remoteContainerId, astridUpdatedAt?, remoteUpdatedAt?, metadata? }
 */
export const PUT = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
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
      where: { userId_provider: { userId: auth.userId, provider: 'GITHUB_ISSUES' } },
    })
    if (!integration || integration.revokedAt) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }
    // Merge metadata over the existing value: partial upserts (watermark-only
    // pushes, comment-map updates) must not clobber other keys.
    const existingLink = await prisma.externalTaskLink.findUnique({
      where: { userId_astridTaskId_provider: { userId: auth.userId, astridTaskId, provider: 'GITHUB_ISSUES' } },
    })
    const mergedMetadata = body.metadata
      ? { ...(existingLink?.metadata as object || {}), ...body.metadata }
      : undefined

    let link
    try {
      link = await prisma.externalTaskLink.upsert({
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
    } catch (e: unknown) {
      // Multi-device race: another device already linked this remoteId to a
      // DIFFERENT task (violates @@unique([provider, remoteId, userId])).
      // Return the existing row so the caller can adopt/dedup instead of a 500.
      if ((e as { code?: string })?.code === 'P2002') {
        const existing = await prisma.externalTaskLink.findFirst({
          where: { provider: 'GITHUB_ISSUES', remoteId, userId: auth.userId },
        })
        if (existing) return NextResponse.json({ link: existing, adopted: true })
      }
      throw e
    }
    return NextResponse.json({ link })
  }
)
