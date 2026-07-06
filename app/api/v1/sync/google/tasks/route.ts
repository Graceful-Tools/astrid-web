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
    const url0 = new URL(req.url)
    const linkId = url0.searchParams.get('linkId')
    const directTasklistId = url0.searchParams.get('tasklistId')
    if (!linkId && !directTasklistId) return NextResponse.json({ error: 'linkId or tasklistId required' }, { status: 400 })
    // Direct-tasklist mode (Astrid "My Tasks" ↔ Google default list): no
    // ExternalListLink row exists, so no server cursor — always a full pull.
    const link = linkId
      ? await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
      : null
    if (linkId && !link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const containerId: string = link ? link.remoteContainerId : (directTasklistId as string)
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const full = !link || url0.searchParams.get('full') === '1'
    // Client-acknowledged cursor: when set, DON'T advance the stored cursor on
    // GET — the client commits it (POST action:commitCursor) only AFTER it has
    // applied the pulled changes, so a kill mid-pass re-pulls instead of
    // permanently skipping unapplied remote edits. Backward-compatible.
    const deferCursor = url0.searchParams.get('deferCursor') === '1'
    const updatedMin = !full && link?.cursor ? `&updatedMin=${encodeURIComponent(link.cursor)}` : ''
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
        `/lists/${encodeURIComponent(containerId)}/tasks?maxResults=100&showCompleted=true&showHidden=true&showDeleted=true${updatedMin}${tokenParam}`
      )
      if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      rawItems.push(...((json.items as any[]) || []))
      pageToken = (json.nextPageToken as string | undefined) || ''
      pages += 1
      if (pageToken && pages >= 10) { truncated = true; break }
    } while (pageToken)

    const items = rawItems.map(t => ({
      remoteId: `${containerId}:${t.id}`,
      title: (t.title as string) || '',
      notes: (t.notes as string | null) ?? null,
      completed: t.status === 'completed',
      dueDate: (t.due as string | null) ?? null,   // RFC3339, date-only semantics
      completedAt: (t.completed as string | null) ?? null,  // Google's completion timestamp
      remoteUpdatedAt: t.updated as string,
      metadata: {
        googleTaskId: String(t.id),
        parent: t.parent ? String(t.parent) : '',
        position: t.position ? String(t.position) : '',
        deleted: t.deleted ? '1' : '',
      },
    }))

    let newCursor = link?.cursor ?? null
    if (link && !full && !truncated) {
      for (const i of items) if (!newCursor || i.remoteUpdatedAt > newCursor) newCursor = i.remoteUpdatedAt
    }
    if (link && newCursor && newCursor !== link.cursor && !deferCursor) {
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
    // Client-acknowledged cursor commit: persist the cursor the client applied.
    if (body?.action === 'commitCursor') {
      const link = await prisma.externalListLink.findFirst({ where: { id: body.linkId, userId: auth.userId } })
      if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
      if (body.cursor && body.cursor !== link.cursor) {
        await prisma.externalListLink.update({
          where: { id: link.id },
          data: { cursor: String(body.cursor), lastReconciledAt: new Date() },
        })
      }
      return NextResponse.json({ ok: true })
    }
    const { linkId, remoteId, tasklistId: directTasklistId } = body || {}
    if (!linkId && !directTasklistId) return NextResponse.json({ error: 'linkId or tasklistId required' }, { status: 400 })
    const link = linkId
      ? await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
      : null
    if (linkId && !link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const containerId: string = link ? link.remoteContainerId : String(directTasklistId)
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const listPath = `/lists/${encodeURIComponent(containerId)}/tasks`
    const payload: Record<string, unknown> = {}
    if (body.title !== undefined) payload.title = body.title
    if (body.notes !== undefined) payload.notes = body.notes
    if (body.dueDate !== undefined) payload.due = body.dueDate      // RFC3339 or null
    if (body.completed !== undefined) payload.status = body.completed ? 'completed' : 'needsAction'

    if (remoteId) {
      // Defense in depth: remoteId is `tasklistId:taskId`. Reject a mismatch so
      // a wrong (linkId/tasklistId, remoteId) pair can't PATCH another list's
      // task. The client also guards this (SyncContainerGuard).
      const remoteContainer = String(remoteId).split(':')[0]
      if (remoteContainer !== containerId) {
        return NextResponse.json({ error: 'remoteId container does not match link' }, { status: 400 })
      }
      const googleTaskId = String(remoteId).split(':').pop()
      const { status, json } = await googleRequest(token, 'PATCH', `${listPath}/${encodeURIComponent(googleTaskId as string)}`, payload)
      if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      return NextResponse.json({ remoteId, remoteUpdatedAt: json.updated })
    }

    const parentQuery = body.parentRemoteId
      ? `?parent=${encodeURIComponent(String(body.parentRemoteId).split(':').pop() as string)}`
      : ''
    const { status, json } = await googleRequest(token, 'POST', `${listPath}${parentQuery}`, payload)
    if (status !== 200) return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    return NextResponse.json({
      remoteId: `${containerId}:${json.id}`,
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
    const directTasklistId = url.searchParams.get('tasklistId')
    const remoteId = url.searchParams.get('remoteId')
    if ((!linkId && !directTasklistId) || !remoteId) return NextResponse.json({ error: 'linkId (or tasklistId) and remoteId required' }, { status: 400 })
    const link = linkId
      ? await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
      : null
    if (linkId && !link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    const containerId: string = link ? link.remoteContainerId : String(directTasklistId)
    const token = await googleTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'Google not connected' }, { status: 401 })

    const taskId = String(remoteId).split(':').pop()
    const { status, json } = await googleRequest(
      token, 'DELETE',
      `/lists/${encodeURIComponent(containerId)}/tasks/${encodeURIComponent(taskId as string)}`
    )
    // 204 = deleted; 404/410 = already gone — both success for our purposes.
    if (status !== 204 && status !== 404 && status !== 410) {
      return NextResponse.json({ error: 'Google error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
    }
    return NextResponse.json({ success: true })
  }
)
