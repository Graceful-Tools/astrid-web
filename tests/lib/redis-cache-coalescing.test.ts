import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/redis')

const client = {
  isReady: true,
  on: vi.fn(),
  connect: vi.fn(),
  get: vi.fn(),
  setEx: vi.fn(),
  sAdd: vi.fn(),
  expire: vi.fn(),
}

vi.mock('redis', () => ({
  createClient: vi.fn(() => client),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(),
}))

describe('RedisCache stampede metrics (task 96127607)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.REDIS_URL = 'redis://test'
    client.get.mockResolvedValue(null)
    client.setEx.mockResolvedValue('OK')
    client.sAdd.mockResolvedValue(1)
    client.expire.mockResolvedValue(1)

    const { RedisCache } = await import('@/lib/redis')
    RedisCache.resetMetrics()
  })

  it('coalesces concurrent misses and reports the saved loads', async () => {
    const { RedisCache } = await import('@/lib/redis')
    let release!: (value: string) => void
    const fetcher = vi.fn(() => new Promise<string>(resolve => {
      release = resolve
    }))

    const first = RedisCache.getOrSet('tasks:user:u1', fetcher)
    const second = RedisCache.getOrSet('tasks:user:u1', fetcher)
    const third = RedisCache.getOrSet('tasks:user:u1', fetcher)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    release('value')
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'value',
      'value',
      'value',
    ])

    expect(RedisCache.getMetrics()).toMatchObject({
      misses: 3,
      loads: 1,
      coalesced: 2,
      loadErrors: 0,
    })
  })

  it('does not stampede retries when the shared loader fails', async () => {
    const { RedisCache } = await import('@/lib/redis')
    const fetcher = vi.fn().mockRejectedValue(new Error('database unavailable'))

    const results = await Promise.allSettled([
      RedisCache.getOrSet('tasks:user:u2', fetcher),
      RedisCache.getOrSet('tasks:user:u2', fetcher),
      RedisCache.getOrSet('tasks:user:u2', fetcher),
    ])

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(RedisCache.getMetrics()).toMatchObject({
      loads: 1,
      coalesced: 2,
      loadErrors: 1,
    })
  })
})
