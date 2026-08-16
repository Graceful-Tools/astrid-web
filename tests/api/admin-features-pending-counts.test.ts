/**
 * The admin features list carries a pending-request count per flag
 * (task 3cef96ef).
 *
 * Jon: "This should link to a separate admin page for every pending feature
 * with the same set of options... Pending requests should be per-feature and
 * should be a general config manager."
 *
 * The index page needs to show, for every feature, how many people are waiting
 * on it — that is the number that tells an admin which feature to open. Without
 * this the page would have to call the feature-requests endpoint once per
 * feature just to render a badge, and that cost grows with every feature added.
 *
 * COUNTS ONLY PENDING. Granted and declined rows stay in the table forever as
 * the audit trail, so counting all rows would show a queue that never empties.
 *
 * EVERY FLAG GETS A NUMBER, including zero. An absent key would make a feature
 * with no requests indistinguishable from one whose count failed to load, and
 * the UI would have to guess.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  featureFlag: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  featureAccessRequest: { groupBy: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))
// requireAdmin resolves for an admin; AdminAuthError must still be a real class
// because the route does `error instanceof AdminAuthError` in its catch.
class AdminAuthError extends Error {}
vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(async () => undefined),
  AdminAuthError,
}))

const flagRow = (key: string) => ({
  id: `flag-${key}`,
  key,
  displayName: key,
  description: null,
  enabled: true,
  rolloutMode: 'SELECTED_USERS',
  rolloutPercentage: 0,
  version: 1,
  targets: [],
  audits: [],
  updatedAt: new Date(),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findMany.mockResolvedValue([])
  mockPrisma.featureFlag.findMany.mockResolvedValue([
    flagRow('google_tasks'),
    flagRow('project_mode'),
    flagRow('task_cost'),
  ] as never)
})

describe('GET /api/admin/features pending counts (task 3cef96ef)', () => {
  it('reports a pending count for every flag', async () => {
    mockPrisma.featureAccessRequest.groupBy.mockResolvedValue([
      { featureKey: 'project_mode', _count: { _all: 4 } },
    ] as never)

    const { GET } = await import('@/app/api/admin/features/route')
    const body = await (await GET()).json()

    const counts = Object.fromEntries(
      body.flags.map((flag: { key: string; pendingRequests: number }) => [
        flag.key,
        flag.pendingRequests,
      ]),
    )
    expect(counts).toEqual({ google_tasks: 0, project_mode: 4, task_cost: 0 })
  })

  it('counts PENDING only, not the granted/declined audit trail', async () => {
    const { GET } = await import('@/app/api/admin/features/route')
    mockPrisma.featureAccessRequest.groupBy.mockResolvedValue([] as never)
    await (await GET()).json()

    const call = mockPrisma.featureAccessRequest.groupBy.mock.calls[0][0]
    expect(call.where).toMatchObject({ status: 'PENDING' })
  })

  it('still returns the flags themselves', async () => {
    // The count is an addition; nothing the rollout editor reads may be lost.
    mockPrisma.featureAccessRequest.groupBy.mockResolvedValue([] as never)
    const { GET } = await import('@/app/api/admin/features/route')
    const body = await (await GET()).json()

    expect(body.flags).toHaveLength(3)
    expect(body.flags[0]).toMatchObject({ key: 'google_tasks', rolloutMode: 'SELECTED_USERS' })
    expect(body.flags[0]).toHaveProperty('targets')
  })
})
