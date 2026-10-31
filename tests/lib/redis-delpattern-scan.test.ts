/**
 * RedisCache.delPattern's SCAN fallback on Upstash (AWTD-1433).
 *
 * When the keyset for a pattern is empty, delPattern falls back to the Upstash
 * adapter's keys(), which walks SCAN cursors until the server returns 0.
 * Nothing exercised that loop. A fake Upstash client pages through several
 * cursors here, so a loop that stops after one page, or hands back the wrong
 * cursor, leaves keys behind and fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fake = vi.hoisted(() => ({
  scan: vi.fn(),
  smembers: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    scan = fake.scan
    smembers = fake.smembers
    del = fake.del
  },
}))

vi.unmock('@/lib/redis')
const { RedisCache } = await vi.importActual<typeof import('@/lib/redis')>('@/lib/redis')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
  fake.smembers.mockResolvedValue([])
  fake.del.mockResolvedValue(1)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('delPattern SCAN fallback on Upstash', () => {
  it('follows the cursor across pages and deletes every match', async () => {
    fake.scan
      .mockResolvedValueOnce(['17', ['tasks:user:u1', 'tasks:user:u1:p2']])
      .mockResolvedValueOnce(['42', []])
      .mockResolvedValueOnce(['5', ['tasks:user:u1:p3']])
      .mockResolvedValueOnce(['0', ['tasks:user:u1:p4']])

    await RedisCache.delPattern('tasks:user:u1*')

    expect(fake.scan.mock.calls.map(call => call[0])).toEqual([0, 17, 42, 5])
    expect(fake.scan).toHaveBeenCalledWith(0, { match: 'tasks:user:u1*', count: 100 })
    expect(fake.del).toHaveBeenCalledTimes(1)
    expect(fake.del).toHaveBeenCalledWith(
      'tasks:user:u1',
      'tasks:user:u1:p2',
      'tasks:user:u1:p3',
      'tasks:user:u1:p4',
    )
  })

  it('accepts numeric cursors as well as string ones', async () => {
    fake.scan
      .mockResolvedValueOnce([9, ['tasks:user:u1']])
      .mockResolvedValueOnce([0, ['tasks:user:u1:p2']])

    await RedisCache.delPattern('tasks:user:u1*')

    expect(fake.scan.mock.calls.map(call => call[0])).toEqual([0, 9])
    expect(fake.del).toHaveBeenCalledWith('tasks:user:u1', 'tasks:user:u1:p2')
  })

  it('deletes nothing when no page matches', async () => {
    fake.scan.mockResolvedValueOnce(['3', []]).mockResolvedValueOnce(['0', []])

    await RedisCache.delPattern('tasks:user:u1*')

    expect(fake.scan).toHaveBeenCalledTimes(2)
    expect(fake.del).not.toHaveBeenCalled()
  })

  it('does not scan when the keyset already names the keys', async () => {
    fake.smembers.mockResolvedValueOnce(['tasks:user:u1'])

    await RedisCache.delPattern('tasks:user:u1*')

    expect(fake.scan).not.toHaveBeenCalled()
    expect(fake.del).toHaveBeenCalledWith('tasks:user:u1')
  })
})
