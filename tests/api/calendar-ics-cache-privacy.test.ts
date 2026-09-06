/**
 * RED for task f9ba26b3-7e2c-47ba-aa01-88b419aa8deb.
 *
 * GET /api/calendar/tasks.ics is authenticated per user and returns that user's
 * tasks — titles, descriptions, assignees — yet answered with
 * `Cache-Control: public, max-age=300`. `public` explicitly authorises a SHARED
 * cache to store it, and the URL carries no user identity, so any intermediary
 * keyed on URL alone (a CDN, a corporate proxy, an ISP cache) may serve one
 * user's calendar to the next person who asks for it.
 *
 * The task filed this under performance; it is a cross-user data leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const findUnique = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderSettings: { findUnique },
    task: { findMany },
  },
}))
vi.mock('@/lib/brand/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  capabilityGate: () => null,
}))

const { GET } = await import('@/app/api/calendar/tasks.ics/route')

function request() {
  return new Request('https://example.test/api/calendar/tasks.ics') as never
}

/** `public` on a per-user body is the bug; a shared cache may store and re-serve it. */
function assertNotSharedCacheable(header: string | null) {
  expect(header).toBeTruthy()
  expect(header).not.toMatch(/\bpublic\b/)
  expect(header).toMatch(/\bprivate\b|\bno-store\b/)
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue({ user: { id: 'user-1' } })
  findMany.mockResolvedValue([])
})

describe('calendar feed caching (task f9ba26b3)', () => {
  it('does not let a shared cache store a populated per-user feed', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      enableCalendarSync: true,
      calendarSyncType: 'all',
    })

    const response = await GET(request())
    assertNotSharedCacheable(response.headers.get('Cache-Control'))
  })

  it('does not let a shared cache store the empty-calendar response either', async () => {
    // Same URL, so a cached empty calendar would also be served to a user whose
    // sync IS enabled — and vice versa.
    findUnique.mockResolvedValue({
      userId: 'user-1',
      enableCalendarSync: false,
      calendarSyncType: 'none',
    })

    const response = await GET(request())
    assertNotSharedCacheable(response.headers.get('Cache-Control'))
  })

  it('still returns a calendar', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      enableCalendarSync: true,
      calendarSyncType: 'all',
    })

    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('BEGIN:VCALENDAR')
  })
})

describe('calendar feed is bounded (task f9ba26b3)', () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      enableCalendarSync: true,
      calendarSyncType: 'all',
    })
  })

  it('caps how many events one feed can carry', async () => {
    await GET(request())
    expect(findMany.mock.calls[0][0].take).toBeGreaterThan(0)
  })

  it('keeps the ownership filter AND adds a date window, rather than replacing it', async () => {
    await GET(request())
    const where = findMany.mock.calls[0][0].where

    // Both clauses must survive. Written as two sibling `OR` keys, the second
    // would simply overwrite the first and the feed would leak other users' tasks.
    expect(where.OR).toBeUndefined()
    expect(where.AND).toHaveLength(2)

    const [ownership, window] = where.AND
    expect(ownership.OR).toEqual([{ assigneeId: 'user-1' }, { creatorId: 'user-1' }])
    expect(window.OR.some((clause: Record<string, unknown>) => 'dueDateTime' in clause)).toBe(true)
  })
})
