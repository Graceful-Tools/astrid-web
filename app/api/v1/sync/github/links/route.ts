import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { isValidRepoId } from '@/lib/sync/github'

/** GET /api/v1/sync/github/links[?listId] — the caller's GitHub list links. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const listId = new URL(req.url).searchParams.get('listId')
    const links = await prisma.externalListLink.findMany({
      where: { userId: auth.userId, provider: 'GITHUB_ISSUES', ...(listId ? { astridListId: listId } : {}) },
    })
    return NextResponse.json({ links })
  }
)

/** POST — link an Astrid list to a repo. Body: { astridListId, remoteContainerId } */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const body = await req.json()
    const { astridListId, remoteContainerId } = body || {}
    if (!astridListId || !remoteContainerId) {
      return NextResponse.json({ error: 'astridListId and remoteContainerId are required' }, { status: 400 })
    }
    if (!isValidRepoId(remoteContainerId)) {
      return NextResponse.json({ error: 'remoteContainerId must be owner/repo' }, { status: 400 })
    }
    const list = await prisma.taskList.findFirst({
      where: {
        id: astridListId,
        OR: [{ ownerId: auth.userId }, { listMembers: { some: { userId: auth.userId } } }],
      },
      select: { id: true },
    })
    if (!list) {
      return NextResponse.json({ error: 'List not found or access denied' }, { status: 404 })
    }
    const integration = await prisma.integration.findUnique({
      where: { userId_provider: { userId: auth.userId, provider: 'GITHUB_ISSUES' } },
    })
    if (!integration || integration.revokedAt) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    }
    const link = await prisma.externalListLink.upsert({
      where: { userId_astridListId_provider: { userId: auth.userId, astridListId, provider: 'GITHUB_ISSUES' } },
      create: {
        integrationId: integration.id,
        userId: auth.userId,
        astridListId,
        provider: 'GITHUB_ISSUES',
        remoteContainerId,
        remoteContainerName: remoteContainerId,
      },
      update: { remoteContainerId, remoteContainerName: remoteContainerId, cursor: null },
    })
    return NextResponse.json({ link })
  }
)

/** DELETE ?linkId — unlink. */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const linkId = new URL(req.url).searchParams.get('linkId')
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    await prisma.externalListLink.deleteMany({ where: { id: linkId, userId: auth.userId } })
    return NextResponse.json({ success: true })
  }
)
