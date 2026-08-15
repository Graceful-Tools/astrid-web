/**
 * Pull GitHub issues changed since a link's cursor.
 *
 * PURE MOVE out of GET /api/v1/sync/github/issues (task d8de37c1). The logic is
 * unchanged; only its home is new.
 *
 * WHY IT HAD TO MOVE. The route is wrapped in withAuth({ scopes: ['tasks:read'] }),
 * so it authenticates a USER. The sync cron has a CRON_SECRET and no user
 * identity, so it cannot call that endpoint at all. Making the cron self-fetch
 * its own API would reproduce the 401 bug fixed in task 46acd19c. Server
 * callers call this; the route stays as auth + call.
 *
 * NOTE THE CURSOR CONTRACT. This function never writes the cursor — it only
 * computes it. Committing is the caller's job precisely because the commit must
 * happen AFTER a successful apply: advancing the watermark past issues nobody
 * imported loses them permanently.
 */

import { fromGithubStateReason } from '@/lib/closed-reason'
import { prisma } from '@/lib/prisma'
import { githubGraphQL, githubRequest, isValidRepoId } from '@/lib/sync/github'

/** One provider-neutral item, exactly as clients already receive it. */
export interface PulledIssue {
  remoteId: string
  title: string
  notes: string | null
  completed: boolean
  completedAt: string | null
  closedReason: ReturnType<typeof fromGithubStateReason>
  remoteUpdatedAt: string
  metadata: {
    number: string
    parent: string
    assigneeUserId: string
    commentCount: string
    labels: string
    assignees: string
    state_reason: string
  }
}

export interface PullResult {
  items: PulledIssue[]
  /** Computed, NOT committed — see the header. */
  cursor: string | null
  /** The page cap cut a still-full listing; the listing is incomplete. */
  truncated: boolean
}

/** Thrown for a GitHub-side failure so the route can map it back to a status. */
export class GithubPullError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'GithubPullError'
  }
}

export async function pullIssuesForLink(args: {
  link: { id: string; remoteContainerId: string; cursor: string | null }
  token: string
  /** Ignore the cursor and pull everything. */
  full?: boolean
}): Promise<PullResult> {
  const { link, token, full = false } = args

  if (!isValidRepoId(link.remoteContainerId)) {
    throw new GithubPullError('Invalid repo link', 400)
  }

  const since = !full && link.cursor ? `&since=${encodeURIComponent(link.cursor)}` : ''

  // Paginate to exhaustion (page cap as a runaway guard). One page per pass
  // starved busy org repos: with PRs sharing the page, open issues beyond
  // the first hundred rows took many passes to appear at all.
  const rawArr: any[] = []
  let page = 1
  let sawFullLastPage = false
  for (;;) {
    const { status, json } = await githubRequest(
      token,
      'GET',
      `/repos/${link.remoteContainerId}/issues?state=all&per_page=100&sort=updated&direction=asc&page=${page}${since}`,
    )
    if (status !== 200) {
      throw new GithubPullError('GitHub error', status >= 400 && status < 500 ? status : 502, json)
    }
    const batch = json as any[]
    rawArr.push(...batch)
    sawFullLastPage = batch.length >= 100
    if (!sawFullLastPage || page >= 10) break
    page += 1
  }

  const items: PulledIssue[] = rawArr
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
        `query { repository(owner: "${owner}", name: "${name}") { ${aliases} } }`,
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
  const allLogins = Array.from(
    new Set(items.flatMap(i => String(i.metadata.assignees || '').split(',').filter(Boolean))),
  )
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
  const cursor = full ? link.cursor : (rawLast ?? link.cursor)

  // Truncated only when the page cap cut a still-full listing — callers
  // must not run absence-based deletion against an incomplete listing.
  return { items, cursor, truncated: sawFullLastPage }
}
