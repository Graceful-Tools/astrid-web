import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'

/**
 * GET /api/v1/sync/github/comments?linkId&remoteId — an issue's comments.
 * Provider-neutral shape: { comments: [{ id, body, author, createdAt }] }.
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const url = new URL(req.url)
    const linkId = url.searchParams.get('linkId')
    const remoteId = url.searchParams.get('remoteId')
    if (!linkId || !remoteId) return NextResponse.json({ error: 'linkId and remoteId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    const number = String(remoteId).split('#').pop()
    if (!number || !/^\d+$/.test(number)) return NextResponse.json({ error: 'Invalid remoteId' }, { status: 400 })

    // Paginate to exhaustion: a single ?per_page=100 page silently drops the
    // newest comments on issues with >100 comments, which the client then
    // treats as remote-deleted and deletes their Astrid twins (permanent local
    // loss). Page cap as a runaway guard.
    const raw: any[] = []
    for (let page = 1; page <= 20; page++) {
      const { status, json } = await githubRequest(
        token, 'GET',
        `/repos/${link.remoteContainerId}/issues/${number}/comments?per_page=100&page=${page}`
      )
      if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      const batch = json as any[]
      raw.push(...batch)
      if (batch.length < 100) break
    }

    const comments = raw.map(c => ({
      id: String(c.id),
      body: (c.body as string) ?? '',
      author: c.user?.login ?? 'unknown',
      createdAt: c.created_at as string,
    }))
    return NextResponse.json({ comments })
  }
)

/** POST — add a comment to an issue. Body: { linkId, remoteId, body } → { id } */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const body = await req.json().catch(() => null)
    const { linkId, remoteId } = body || {}
    const text = (body?.body as string | undefined)?.trim()
    if (!linkId || !remoteId || !text) {
      return NextResponse.json({ error: 'linkId, remoteId, body required' }, { status: 400 })
    }
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    const number = String(remoteId).split('#').pop()
    if (!number || !/^\d+$/.test(number)) return NextResponse.json({ error: 'Invalid remoteId' }, { status: 400 })
    const { status, json } = await githubRequest(
      token, 'POST', `/repos/${link.remoteContainerId}/issues/${number}/comments`, { body: text }
    )
    if (status !== 201) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    return NextResponse.json({ id: String(json.id) })
  }
)

/** PATCH — edit an issue comment. Body: { linkId, commentId, body } */
export const PATCH = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const body = await req.json().catch(() => null)
    const { linkId, commentId } = body || {}
    const text = (body?.body as string | undefined)?.trim()
    if (!linkId || !commentId || !text) {
      return NextResponse.json({ error: 'linkId, commentId, body required' }, { status: 400 })
    }
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    if (!/^\d+$/.test(String(commentId))) return NextResponse.json({ error: 'Invalid commentId' }, { status: 400 })
    const { status, json } = await githubRequest(
      token, 'PATCH', `/repos/${link.remoteContainerId}/issues/comments/${commentId}`, { body: text }
    )
    if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    return NextResponse.json({ id: String(json.id) })
  }
)

/** DELETE ?linkId&commentId — delete an issue comment (404 = already gone). */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const url = new URL(req.url)
    const linkId = url.searchParams.get('linkId')
    const commentId = url.searchParams.get('commentId')
    if (!linkId || !commentId) return NextResponse.json({ error: 'linkId and commentId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    if (!/^\d+$/.test(String(commentId))) return NextResponse.json({ error: 'Invalid commentId' }, { status: 400 })
    const { status, json } = await githubRequest(
      token, 'DELETE', `/repos/${link.remoteContainerId}/issues/comments/${commentId}`
    )
    if (status !== 204 && status !== 404 && status !== 410) {
      return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    }
    return NextResponse.json({ success: true })
  }
)
