/**
 * The abandoned-upload sweep route (task 276b3086).
 *
 * The decision logic has its own tests; this covers the route, which had none —
 * and a route that deletes files is the wrong place to leave the auth check,
 * the delegation and the error path unverified.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sweepAbandonedUploads = vi.fn()
const countAmbiguousLegacyUploads = vi.fn()

vi.mock('@/lib/abandoned-uploads', async () => {
  const actual = await vi.importActual<typeof import('@/lib/abandoned-uploads')>(
    '@/lib/abandoned-uploads',
  )
  return {
    ...actual,
    sweepAbandonedUploads: (...args: unknown[]) => sweepAbandonedUploads(...args),
    countAmbiguousLegacyUploads: (...args: unknown[]) => countAmbiguousLegacyUploads(...args),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/secure-storage', () => ({ deleteFile: vi.fn() }))

const { GET } = await import('@/app/api/cron/abandoned-uploads/route')

const request = (auth?: string) =>
  ({ headers: { get: (k: string) => (k === 'authorization' ? auth ?? null : null) } }) as never

describe('GET /api/cron/abandoned-uploads (task 276b3086)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    sweepAbandonedUploads.mockResolvedValue({ rowsDeleted: 2, blobsDeleted: 2, blobFailures: 0 })
    countAmbiguousLegacyUploads.mockResolvedValue(0)
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('refuses a caller without the cron secret', async () => {
    process.env.CRON_SECRET = 'shhh'

    const response = await GET(request('Bearer wrong'))

    expect(response.status).toBe(401)
    // The important half: it must not have deleted anything on the way to 401.
    expect(sweepAbandonedUploads).not.toHaveBeenCalled()
  })

  it('refuses a caller with no authorization header at all', async () => {
    process.env.CRON_SECRET = 'shhh'

    const response = await GET(request(undefined))

    expect(response.status).toBe(401)
    expect(sweepAbandonedUploads).not.toHaveBeenCalled()
  })

  it('runs the sweep for a correctly authorized cron call', async () => {
    process.env.CRON_SECRET = 'shhh'

    const response = await GET(request('Bearer shhh'))

    expect(response.status).toBe(200)
    expect(sweepAbandonedUploads).toHaveBeenCalledTimes(1)
  })

  it('reports what it reclaimed', async () => {
    process.env.CRON_SECRET = 'shhh'
    sweepAbandonedUploads.mockResolvedValue({ rowsDeleted: 7, blobsDeleted: 6, blobFailures: 1 })

    const body = await (await GET(request('Bearer shhh'))).json()

    expect(body).toMatchObject({ success: true, rowsDeleted: 7, blobsDeleted: 6, blobFailures: 1 })
  })

  it('reports how many pre-discriminator rows remain unclassifiable', async () => {
    // Legacy rows cannot be swept — attachTarget null with commentId null is
    // exactly the shape of a task-form upload, and since b4a362f1 those render
    // as task attachments. Counting them is the honest alternative to a shrug:
    // it turns the backlog into a number someone can act on.
    process.env.CRON_SECRET = 'shhh'
    countAmbiguousLegacyUploads.mockResolvedValue(41)

    const body = await (await GET(request('Bearer shhh'))).json()

    expect(body.legacyAmbiguous).toBe(41)
  })

  it('returns 500 rather than a partial success when the sweep throws', async () => {
    process.env.CRON_SECRET = 'shhh'
    sweepAbandonedUploads.mockRejectedValue(new Error('db gone'))

    const response = await GET(request('Bearer shhh'))

    expect(response.status).toBe(500)
  })
})
