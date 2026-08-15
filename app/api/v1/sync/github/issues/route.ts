import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { toGithubStateReason } from '@/lib/closed-reason'
import { prisma } from '@/lib/prisma'
import { githubRequest, githubTokenFor, isValidRepoId } from '@/lib/sync/github'
import { GithubPullError, pullIssuesForLink } from '@/lib/sync/github/pull-issues'

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

    // The pull itself lives in lib so server callers (the sync cron) can invoke
    // it directly — this route authenticates a USER, which a cron does not have.
    let result
    try {
      result = await pullIssuesForLink({ link, token, full })
    } catch (error) {
      if (error instanceof GithubPullError) {
        return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status })
      }
      throw error
    }

    const { items, cursor: newCursor, truncated } = result
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
