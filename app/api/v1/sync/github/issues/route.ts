import { BRAND } from '@/lib/brand/config'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { fromGithubStateReason, toGithubStateReason } from '@/lib/closed-reason'
import { prisma } from '@/lib/prisma'
import { githubGraphQL, githubRequest, githubTokenFor, isValidRepoId } from '@/lib/sync/github'

/**
 * GET /api/v1/sync/github/issues?linkId — pull issues changed since the link's
 * cursor (ISO timestamp). Returns provider-neutral items + advances the cursor.
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const linkId = new URL(req.url).searchParams.get('linkId')
    if (!linkId) return NextResponse.json({ error: 'linkId required' }, { status: 400 })
    const link = await prisma.externalListLink.findFirst({ where: { id: linkId, userId: auth.userId } })
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    if (!isValidRepoId(link.remoteContainerId)) {
      return NextResponse.json({ error: 'Invalid repo link' }, { status: 400 })
    }
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })

    const full = new URL(req.url).searchParams.get('full') === '1'
    // Client-acknowledged cursor (see google/tasks route): defer the DB advance
    // to a post-apply commit so a kill mid-pass re-pulls instead of skipping.
    const deferCursor = new URL(req.url).searchParams.get('deferCursor') === '1'
    const since = !full && link.cursor ? `&since=${encodeURIComponent(link.cursor)}` : ''
    // Paginate to exhaustion (page cap as a runaway guard). One page per pass
    // starved busy org repos: with PRs sharing the page, open issues beyond
    // the first hundred rows took many passes to appear at all.
    const rawArr: any[] = []
    let page = 1
    let sawFullLastPage = false
    for (;;) {
      const { status, json } = await githubRequest(
        token, 'GET',
        `/repos/${link.remoteContainerId}/issues?state=all&per_page=100&sort=updated&direction=asc&page=${page}${since}`
      )
      if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: status >= 400 && status < 500 ? status : 502 })
      const batch = json as any[]
      rawArr.push(...batch)
      sawFullLastPage = batch.length >= 100
      if (!sawFullLastPage || page >= 10) break
      page += 1
    }

    const items = (rawArr as any[])
      .filter(i => !i.pull_request) // issues only, not PRs
      .map(i => ({
        remoteId: `${link.remoteContainerId}#${i.number}`,
        title: i.title as string,
        notes: (i.body as string | null) ?? null,
        completed: i.state === 'closed',
        completedAt: (i.closed_at as string | null) ?? null,
        // GitHub's "closed as not planned" is our canceled state (task
        // 11042ae3). GitHub can't tell us which of our three reasons it was,
        // so it maps to the most general one.
        closedReason: fromGithubStateReason(i.state_reason),
        remoteUpdatedAt: i.updated_at as string,
        metadata: {
          number: String(i.number),
          parent: '', // parent issue number, filled from GraphQL below
          assigneeUserId: '', // {BRAND.appName} user mapped from GitHub assignees below
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
      // Chunk the aliased lookups: a single query with up to ~1000 aliases can
      // hit GitHub's GraphQL node limit / time out (5-10s, ~30s cap on cold
      // Neon). ~100 per request is still 100× better than per-issue REST.
      const CHUNK = 100
      for (let start = 0; start < items.length; start += CHUNK) {
        const chunk = items.slice(start, start + CHUNK)
        const aliases = chunk
          .map((i, j) => `i${j}: issue(number: ${Number(i.metadata.number)}) { number parent { number } }`)
          .join(' ')
        const gql = await githubGraphQL(
          token,
          `query { repository(owner: "${owner}", name: "${name}") { ${aliases} } }`
        )
        const repo = gql?.data?.repository
        if (repo) {
          for (let j = 0; j < chunk.length; j++) {
            const parentNumber = repo[`i${j}`]?.parent?.number
            items[start + j].metadata.parent = parentNumber ? String(parentNumber) : ''
          }
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

    // Cursor advances from the RAW listing (issues + PRs): pure-PR pages must
    // still move the window forward or the pull stalls forever.
    const rawLast = rawArr.length ? (rawArr[rawArr.length - 1].updated_at as string) : null
    const newCursor = full ? link.cursor : (rawLast ?? link.cursor)
    // Truncated only when the page cap cut a still-full listing — clients
    // must not run absence-based deletion against an incomplete listing.
    const truncated = sawFullLastPage
    if (newCursor && newCursor !== link.cursor && !deferCursor) {
      await prisma.externalListLink.update({
        where: { id: link.id },
        data: { cursor: newCursor, lastReconciledAt: new Date() },
      })
    }
    return NextResponse.json({ items, cursor: newCursor, truncated })
  }
)

/**
 * POST — push a task to GitHub. Body: { linkId, title, body?, state?, remoteId? }.
 * remoteId nil = create issue; non-nil = update (title/body/state).
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.sync.github', capability: 'syncGithubIssues' },
  async (req, auth) => {
    const body = await req.json()
    // Client-acknowledged cursor commit.
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

    if (!isValidRepoId(link.remoteContainerId)) {
      return NextResponse.json({ error: 'Invalid repo link' }, { status: 400 })
    }
    if (remoteId) {
      // Defense in depth: the remoteId embeds its own container
      // (owner/repo#number). Reject if it doesn't match the link's container —
      // otherwise a mismatched (linkId, remoteId) pair PATCHes the wrong repo's
      // issue number. The client also guards this (SyncContainerGuard).
      const [remoteContainer] = String(remoteId).split('#')
      if (remoteContainer !== link.remoteContainerId) {
        return NextResponse.json({ error: 'remoteId container does not match link' }, { status: 400 })
      }
      const number = String(remoteId).split('#').pop()
      if (!number || !/^\d+$/.test(number)) return NextResponse.json({ error: 'Invalid remoteId' }, { status: 400 })
      const { status, json } = await githubRequest(
        token, 'PATCH', `/repos/${link.remoteContainerId}/issues/${number}`,
        {
          title,
          body: body.body,
          state: body.state,
          // Closing as canceled must land as "closed as not planned" on
          // GitHub, not a plain completion (task 11042ae3). Only sent when
          // closing — GitHub rejects state_reason on an open issue.
          ...(body.state === 'closed'
            ? { state_reason: toGithubStateReason(body.closedReason) }
            : {}),
          ...(assignees !== undefined ? { assignees } : {}),
        }
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
      if (!parentNumber || !/^\d+$/.test(parentNumber)) {
        return NextResponse.json({
          remoteId: `${link.remoteContainerId}#${json.number}`,
          remoteUpdatedAt: json.updated_at,
        })
      }
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
