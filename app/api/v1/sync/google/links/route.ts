import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'

/** GET /api/v1.sync.google/links[?listId] — the caller's GitHub list links. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.google', capability: 'syncGoogleTasks' },
  async (req, auth) => {
    const listId = new URL(req.url).searchParams.get('listId')
    const links = await prisma.externalListLink.findMany({
      where: { userId: auth.userId, provider: 'GOOGLE_TASKS', ...(listId ? { astridListId: listId } : {}) },
    })
    return NextResponse.json({ links })
  }
)

/** POST — link an Astrid list to a repo. Body: { astridListId, remoteContainerId } */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google', capability: 'syncGoogleTasks' },
  async (req, auth) => {
    const body = await req.json()
    const { astridListId, remoteContainerId } = body || {}
    if (!astridListId || !remoteContainerId) {
      return NextResponse.json({ error: 'astridListId and remoteContainerId are required' }, { status: 400 })
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
      where: { userId_provider: { userId: auth.userId, provider: 'GOOGLE_TASKS' } },
    })
    if (!integration || integration.revokedAt) {
      return NextResponse.json({ error: 'Google not connected' }, { status: 401 })
    }
    // Store the tasklist's human name — clients must never have to render
    // the opaque Google tasklist id.
    let remoteContainerName: string | null = null
    const token = await googleTokenFor(auth.userId)
    if (token) {
      const { status, json } = await googleRequest(
        token, 'GET', `/users/@me/lists/${encodeURIComponent(remoteContainerId)}`)
      if (status === 200 && json?.title) remoteContainerName = String(json.title)
    }

    const link = await prisma.externalListLink.upsert({
      where: { userId_astridListId_provider: { userId: auth.userId, astridListId, provider: 'GOOGLE_TASKS' } },
      create: {
        integrationId: integration.id,
        userId: auth.userId,
        astridListId,
        provider: 'GOOGLE_TASKS',
        remoteContainerId,
        remoteContainerName,
      },
      update: { remoteContainerId, remoteContainerName, cursor: null },
    })
    return NextResponse.json({ link })
  }
)

/** DELETE ?linkId — unlink. */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google', capability: 'syncGoogleTasks' },
  async (req, auth) => {
    const linkId = new URL(req.url).searchParams.get('linkId')
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    await prisma.externalListLink.deleteMany({ where: { id: linkId, userId: auth.userId } })
    return NextResponse.json({ success: true })
  }
)
