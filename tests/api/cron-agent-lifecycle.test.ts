import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reconcileAllAgentLifecycleBoards = vi.fn()

vi.mock('@/lib/agent-lifecycle', () => ({
  reconcileAllAgentLifecycleBoards: (...args: unknown[]) =>
    reconcileAllAgentLifecycleBoards(...args),
}))

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  reconcileAllAgentLifecycleBoards.mockResolvedValue({
    scanned: 4,
    transitioned: 2,
    unchanged: 2,
  })
})

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_SECRET
})

const request = (authorization?: string) =>
  ({
    headers: {
      get: (key: string) => key === 'authorization' ? authorization ?? null : null,
    },
  }) as never

const validAuthorization = () => ['Bearer', process.env.CRON_SECRET].join(' ')

describe('GET /api/cron/agent-lifecycle (AWTD-760)', () => {
  it('fails closed without the configured secret', async () => {
    const { GET } = await import('@/app/api/cron/agent-lifecycle/route')
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(reconcileAllAgentLifecycleBoards).not.toHaveBeenCalled()
  })

  it('reconciles opted-in boards for the scheduler', async () => {
    const { GET } = await import('@/app/api/cron/agent-lifecycle/route')
    const response = await GET(request(validAuthorization()))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      scanned: 4,
      transitioned: 2,
      unchanged: 2,
    })
    expect(reconcileAllAgentLifecycleBoards).toHaveBeenCalledTimes(1)
  })

  it('returns an error rather than success when reconciliation fails', async () => {
    reconcileAllAgentLifecycleBoards.mockRejectedValue(new Error('database unavailable'))
    const { GET } = await import('@/app/api/cron/agent-lifecycle/route')
    const response = await GET(request(validAuthorization()))

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false })
  })
})
