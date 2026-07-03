import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'

/**
 * GET /api/v1/sync/github/issues?linkId — pull issues changed since the link's
 * cursor (ISO timestamp). Returns provider-neutral items + advances the cursor.
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const linkId = new URL(req.url).searchParams.get('linkId')
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    const full = new URL(req.url).searchParams.get('full') === '1'
    const since = !full && link.cursor ? `&since=${encodeURIComponent(link.cursor)}` : ''
    const { status, json } = await githubRequest(
      token, 'GET',
      `/repos/${link.remoteContainerId}/issues?state=all&per_page=100&sort=updated&direction=asc${since}`
    )
    if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: 502 })

    const items = (json as any[])
      .filter(i => !i.pull_request) // issues only, not PRs
      .map(i => ({
        remoteId: `${link.remoteContainerId}#${i.number}`,
        title: i.title as string,
        notes: (i.body as string | null) ?? null,
        completed: i.state === 'closed',
        remoteUpdatedAt: i.updated_at as string,
        metadata: {
          number: String(i.number),
          labels: (i.labels as any[]).map(l => (typeof l === 'string' ? l : l.name)).join(','),
          assignees: (i.assignees as any[]).map(a => a.login).join(','),
          state_reason: i.state_reason ?? '',
        },
      }))

    const newCursor = full ? link.cursor : (items.length ? items[items.length - 1].remoteUpdatedAt : link.cursor)
    if (newCursor && newCursor !== link.cursor) {
      await prisma.externalListLink.update({
        where: { id: link.id },
        data: { cursor: newCursor, lastReconciledAt: new Date() },
      })
    }
    return NextResponse.json({ items, cursor: newCursor })
  }
)

/**
 * POST — push a task to GitHub. Body: { linkId, title, body?, state?, remoteId? }.
 * remoteId nil = create issue; non-nil = update (title/body/state).
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github' },
  async (req, auth) => {
    const body = await req.json()
    const { linkId, title, remoteId } = body || {}
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    if (remoteId) {
      const number = String(remoteId).split('#').pop()
      const { status, json } = await githubRequest(
        token, 'PATCH', `/repos/${link.remoteContainerId}/issues/${number}`,
        { title, body: body.body, state: body.state }
      )
      if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: 502 })
      return NextResponse.json({ remoteId, remoteUpdatedAt: json.updated_at })
    }

    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const { status, json } = await githubRequest(
      token, 'POST', `/repos/${link.remoteContainerId}/issues`, { title, body: body.body }
    )
    if (status !== 201) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: 502 })
    return NextResponse.json({
      remoteId: `${link.remoteContainerId}#${json.number}`,
      remoteUpdatedAt: json.updated_at,
    })
  }
)
