import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { googleRequest, googleTokenFor } from '@/lib/sync/google'

/**
 * GET ?linkId — pull tasks changed since the link cursor (updatedMin).
 * Google Tasks has no webhooks; clients poll on foreground/nudge.
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.google' },
  async (req, auth) => {
    const linkId = new URL(req.url).searchParams.get('linkId')
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const full = new URL(req.url).searchParams.get('full') === '1'
    const updatedMin = !full && link.cursor ? `&updatedMin=${encodeURIComponent(link.cursor)}` : ''
    // Paginate to exhaustion (page cap as a runaway guard): the cursor is
    // computed from MAX(updated), so a dropped page would permanently skip
    // items whose updated < cursor.
    const rawItems: any[] = []
    let pageToken = ''
    let pages = 0
    let truncated = false
    do {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
      const { status, json } = await googleRequest(
        token, 'GET',
        `/lists/${encodeURIComponent(link.remoteContainerId)}/tasks?maxResults=100&showCompleted=true&showHidden=true&showDeleted=true${updatedMin}${tokenParam}`
      )
      if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      rawItems.push(...((json.items as any[]) || []))
      pageToken = (json.nextPageToken as string | undefined) || ''
      pages += 1
      if (pageToken && pages >= 10) { truncated = true; break }
    } while (pageToken)

    const items = rawItems.map(t => ({
      remoteId: `${link.remoteContainerId}:${t.id}`,
      title: (t.title as string) || '',
      notes: (t.notes as string | null) ?? null,
      completed: t.status === 'completed',
      dueDate: (t.due as string | null) ?? null,   // RFC3339, date-only semantics
      remoteUpdatedAt: t.updated as string,
      metadata: {
        googleTaskId: String(t.id),
        parent: t.parent ? String(t.parent) : '',
        position: t.position ? String(t.position) : '',
        deleted: t.deleted ? '1' : '',
      },
    }))

    let newCursor = link.cursor
    if (!full && !truncated) {
      for (const i of items) if (!newCursor || i.remoteUpdatedAt > newCursor) newCursor = i.remoteUpdatedAt
    }
    if (newCursor && newCursor !== link.cursor) {
      await prisma.externalListLink.update({
        where: { id: link.id },
        data: { cursor: newCursor, lastReconciledAt: new Date() },
      })
    }
    return NextResponse.json({ items, cursor: newCursor, truncated })
  }
)

/**
 * POST — push a task. Body: { linkId, title?, notes?, dueDate?, completed?,
 * remoteId?, parentRemoteId? }. remoteId nil = insert (optionally under parent).
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google' },
  async (req, auth) => {
    const body = await req.json()
    const { linkId, remoteId } = body || {}
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const listPath = `/lists/${encodeURIComponent(link.remoteContainerId)}/tasks`
    const payload: Record<string, unknown> = {}
    if (body.title !== undefined) payload.title = body.title
    if (body.notes !== undefined) payload.notes = body.notes
    if (body.dueDate !== undefined) payload.due = body.dueDate      // RFC3339 or null
    if (body.completed !== undefined) payload.status = body.completed ? 'completed' : 'needsAction'

    if (remoteId) {
      const googleTaskId = String(remoteId).split(':').pop()
      const { status, json } = await googleRequest(token, 'PATCH', `${listPath}/${googleTaskId}`, payload)
      if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      return NextResponse.json({ remoteId, remoteUpdatedAt: json.updated })
    }

    const parentQuery = body.parentRemoteId
      ? `?parent=${encodeURIComponent(String(body.parentRemoteId).split(':').pop() as string)}`
      : ''
    const { status, json } = await googleRequest(token, 'POST', `${listPath}${parentQuery}`, payload)
    if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    return NextResponse.json({
      remoteId: `${link.remoteContainerId}:${json.id}`,
      remoteUpdatedAt: json.updated,
    })
  }
)

/** DELETE ?linkId&remoteId — delete a Google task (404/410 = already gone). */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.google' },
  async (req, auth) => {
    const url = new URL(req.url)
    const linkId = url.searchParams.get('linkId')
    const remoteId = url.searchParams.get('remoteId')
    if (!linkId || !remoteId) return NextResponse.json({ error: 'linkId and remoteId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const taskId = String(remoteId).split(':').pop()
    const { status, json } = await googleRequest(
      token, 'DELETE',
      `/lists/${encodeURIComponent(link.remoteContainerId)}/tasks/${encodeURIComponent(taskId as string)}`
    )
    // 204 = deleted; 404/410 = already gone — both success for our purposes.
    if (status !== 204 && status !== 404 && status !== 410) {
      return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    }
    return NextResponse.json({ success: true })
  }
)
