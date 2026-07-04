import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { githubGraphQL, githubRequest, githubTokenFor } from '@/lib/sync/github'

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
    if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })

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
          parent: '', // parent issue number, filled from GraphQL below
          assigneeUserId: '', // Astrid user mapped from GitHub assignees below
          commentCount: String(i.comments ?? 0),
          labels: (i.labels as any[]).map(l => (typeof l === 'string' ? l : l.name)).join(','),
          assignees: (i.assignees as any[]).map(a => a.login).join(','),
          state_reason: i.state_reason ?? '',
        },
      }))

    // Sub-issue parent lookup: REST issue objects don't expose the parent, so
    // batch one GraphQL query for the pulled numbers. metadata.parent carries
    // the parent's issue number ('' = top-level).
    if (items.length) {
      const [owner, name] = link.remoteContainerId.split('/')
      const aliases = items
        .map((i, idx) => `i${idx}: issue(number: ${Number(i.metadata.number)}) { number parent { number } }`)
        .join(' ')
      const gql = await githubGraphQL(
        token,
        `query { repository(owner: "${owner}", name: "${name}") { ${aliases} } }`
      )
      const repo = gql?.data?.repository
      if (repo) {
        for (let idx = 0; idx < items.length; idx++) {
          const parentNumber = repo[`i${idx}`]?.parent?.number
          items[idx].metadata.parent = parentNumber ? String(parentNumber) : ''
        }
      }
    }

    // Assignee mapping: GitHub logins → Astrid users, via each user's own
    // GITHUB_ISSUES integration (externalAccountId = their login). First
    // resolvable assignee wins; unresolvable assignees stay unmapped.
    const allLogins = Array.from(new Set(
      items.flatMap(i => String(i.metadata.assignees || '').split(',').filter(Boolean))
    ))
    if (allLogins.length) {
      const assigneeIntegrations = await prisma.integration.findMany({
        where: { provider: 'GITHUB_ISSUES', externalAccountId: { in: allLogins }, revokedAt: null },
        select: { externalAccountId: true, userId: true },
      })
      const byLogin = new Map(assigneeIntegrations.map(i => [i.externalAccountId, i.userId]))
      for (const item of items) {
        const match = String(item.metadata.assignees || '').split(',').find(l => byLogin.has(l))
        item.metadata.assigneeUserId = match ? (byLogin.get(match) as string) : ''
      }
    }

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

    // Astrid assignee → GitHub login (the assignee's own connected account);
    // undefined = leave assignees untouched, [] = explicit unassign.
    let assignees: string[] | undefined
    if (body.assigneeUserId !== undefined) {
      if (body.assigneeUserId) {
        const assigneeIntegration = await prisma.integration.findUnique({
          where: { userId_provider: { userId: body.assigneeUserId, provider: 'GITHUB_ISSUES' } },
        })
        assignees = assigneeIntegration?.externalAccountId && !assigneeIntegration.revokedAt
          ? [assigneeIntegration.externalAccountId] : undefined
      } else {
        assignees = []
      }
    }

    if (remoteId) {
      const number = String(remoteId).split('#').pop()
      const { status, json } = await githubRequest(
        token, 'PATCH', `/repos/${link.remoteContainerId}/issues/${number}`,
        { title, body: body.body, state: body.state, ...(assignees !== undefined ? { assignees } : {}) }
      )
      if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      return NextResponse.json({ remoteId, remoteUpdatedAt: json.updated_at })
    }

    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    const { status, json } = await githubRequest(
      token, 'POST', `/repos/${link.remoteContainerId}/issues`,
      { title, body: body.body, ...(assignees?.length ? { assignees } : {}) }
    )
    if (status !== 201) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })

    // Sub-issue: attach the new issue under its parent. Best-effort — a
    // failure leaves a top-level issue rather than failing the push.
    if (body.parentRemoteId) {
      const parentNumber = String(body.parentRemoteId).split('#').pop()
      await githubRequest(
        token, 'POST',
        `/repos/${link.remoteContainerId}/issues/${parentNumber}/sub_issues`,
        { sub_issue_id: json.id }
      )
    }

    return NextResponse.json({
      remoteId: `${link.remoteContainerId}#${json.number}`,
      remoteUpdatedAt: json.updated_at,
    })
  }
)
