/**
 * Every link gets its turn (task df728fba).
 *
 * `syncAllGithubLinks()` selected every GITHUB_ISSUES link with no `orderBy`
 * and no `take`, then processed them one at a time, each iteration doing several
 * sequential network round trips. The caller is a cron route with
 * `maxDuration = 60`, scheduled every 15 minutes.
 *
 * When the pass exceeds 60s the function is killed mid-loop. Cursor safety
 * holds — each link commits its own cursor, so a killed run loses nothing — but
 * the links after the cut-off never run. And with no `orderBy`, Postgres
 * returns an unchanging table in a stable order, so it is the SAME TAIL dropped
 * on every one of the 96 runs a day. Those users' issues silently stop syncing,
 * and nothing says so: the summary counted `links.length`, so even the total
 * looked complete.
 *
 * That is precisely the failure the file header exists to prevent — "a silent
 * permanent loss that presents as 'sync is quiet'" — arriving through
 * scheduling rather than through the cursor.
 *
 * The fix is ordering by staleness plus a bounded batch, and the two halves are
 * not separable: ordering by `lastReconciledAt` while only writing that column
 * when the cursor MOVED would pin a quiet link permanently at the front and
 * starve everyone behind it. Both are asserted here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** In-memory stand-in for the externalListLink table. */
interface Row {
  id: string
  userId: string
  integrationId: string
  astridListId: string
  remoteContainerId: string
  direction: string
  cursor: string | null
  lastReconciledAt: Date | null
}

let table: Row[] = []

const findMany = vi.fn(async (args: any) => {
  let rows = [...table]

  if (args?.orderBy?.lastReconciledAt) {
    const spec = args.orderBy.lastReconciledAt
    const nullsFirst = spec?.nulls === 'first'
    rows.sort((a, b) => {
      if (a.lastReconciledAt === null && b.lastReconciledAt === null) return 0
      if (a.lastReconciledAt === null) return nullsFirst ? -1 : 1
      if (b.lastReconciledAt === null) return nullsFirst ? 1 : -1
      return a.lastReconciledAt.getTime() - b.lastReconciledAt.getTime()
    })
  }

  if (typeof args?.take === 'number') rows = rows.slice(0, args.take)
  return rows
})

const update = vi.fn(async ({ where, data }: any) => {
  const row = table.find(r => r.id === where.id)
  if (row) Object.assign(row, data)
  return row
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalListLink: {
      findMany: (a: any) => findMany(a),
      update: (a: any) => update(a),
      count: async () => table.length,
    },
  },
}))

vi.mock('@/lib/sync/github', () => ({
  githubTokenFor: vi.fn(async () => 'token'),
  isValidRepoId: () => true,
}))
vi.mock('@/lib/sync/github/pull-issues', () => ({
  // A clean pass with nothing new: no cursor movement. This is the case that
  // used to leave lastReconciledAt stale forever.
  pullIssuesForLink: vi.fn(async () => ({ items: [], cursor: null, truncated: false })),
}))
vi.mock('@/lib/sync/github/apply-issues', () => ({
  applyPulledIssues: vi.fn(async () => ({ created: 0, updated: 0, skipped: 0 })),
}))
vi.mock('@/lib/sync/github/push-tasks', () => ({
  directionPulls: () => true,
  pushTasksForLink: vi.fn(async () => ({ pushed: 0, seeded: false })),
}))

const { syncAllGithubLinks, MAX_LINKS_PER_PASS } = await import('@/lib/sync/github/sync-all-links')

function seed(count: number) {
  table = Array.from({ length: count }, (_, i) => ({
    id: `link-${i}`,
    userId: `user-${i}`,
    integrationId: 'integration',
    astridListId: 'list',
    remoteContainerId: 'owner/repo',
    direction: 'BOTH',
    cursor: null,
    lastReconciledAt: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('syncAllGithubLinks fairness', () => {
  it('bounds the batch instead of walking an unbounded list', async () => {
    seed(MAX_LINKS_PER_PASS + 10)

    const summary = await syncAllGithubLinks()

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: MAX_LINKS_PER_PASS }))
    expect(summary.links).toBe(MAX_LINKS_PER_PASS)
  })

  it('orders by staleness, never-synced first', async () => {
    seed(3)

    await syncAllGithubLinks()

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { lastReconciledAt: { sort: 'asc', nulls: 'first' } },
      }),
    )
  })

  it('covers the links the first pass missed on the SECOND pass', async () => {
    // The reported bug: the same tail was dropped on all 96 runs a day.
    const total = MAX_LINKS_PER_PASS + 5
    seed(total)

    await syncAllGithubLinks()
    const firstPass = table.filter(r => r.lastReconciledAt !== null).map(r => r.id)
    expect(firstPass).toHaveLength(MAX_LINKS_PER_PASS)

    await syncAllGithubLinks()
    const everSynced = new Set(table.filter(r => r.lastReconciledAt !== null).map(r => r.id))

    expect(everSynced.size, 'the tail was never reached').toBe(total)
  })

  it('stamps lastReconciledAt even when nothing new arrived', async () => {
    // Without this, a quiet link keeps a stale timestamp, sits permanently at
    // the front of the staleness order, and starves everyone behind it — the
    // ordering change alone would make the bug WORSE.
    seed(1)

    await syncAllGithubLinks()

    expect(table[0].lastReconciledAt, 'a clean, empty sync left the link stale').not.toBeNull()
  })

  it('reports when the batch was capped, so a short pass is visible', async () => {
    seed(MAX_LINKS_PER_PASS + 7)

    const summary = await syncAllGithubLinks()

    expect(summary.capped).toBe(true)
    expect(summary.remaining).toBe(7)
  })

  it('does not claim it was capped when it reached everyone', async () => {
    seed(2)

    const summary = await syncAllGithubLinks()

    expect(summary.capped).toBe(false)
    expect(summary.remaining).toBe(0)
  })
})
