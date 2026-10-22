/**
 * RED for AWTD-1320.
 *
 * Every task write called invalidate.userTasks, which pattern-deleted
 * `tasks:user:<id>*` (and taskUpdate also `comments:task:<id>*`). Only the
 * legacy GET /api/tasks writes `tasks:user:<id>`, and nothing writes
 * `comments:task:*`, so the keyset was almost always empty and delPattern fell
 * through to client.keys() — on Upstash a SCAN loop over the WHOLE keyspace,
 * per audience member, on the hottest write path.
 *
 * The only task-cache key that is ever written is exact, so an exact delete is
 * enough and a pattern delete is pure cost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.unmock('@/lib/redis')
const { RedisCache } = await vi.importActual<typeof import('@/lib/redis')>('@/lib/redis')

let delPattern: ReturnType<typeof vi.spyOn>
let del: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.restoreAllMocks()
  delPattern = vi.spyOn(RedisCache, 'delPattern').mockResolvedValue()
  del = vi.spyOn(RedisCache, 'del').mockResolvedValue()
})

describe('task-write cache invalidation (AWTD-1320)', () => {
  it('userTasks deletes the user task key exactly and never scans', async () => {
    await RedisCache.invalidate.userTasks('u1')
    expect(delPattern).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledWith(RedisCache.keys.userTasks('u1'))
  })

  it('without listIds, still no scan', async () => {
    await RedisCache.invalidate.userTasks('u1')
    expect(delPattern).not.toHaveBeenCalled()
  })

  it('no invalidator is left that pattern-deletes a task or comment family', async () => {
    const source = (await import('fs')).readFileSync('lib/redis.ts', 'utf8')
    expect(source).not.toMatch(/delPattern\(`tasks:user:/)
    expect(source).not.toMatch(/delPattern\(`comments:task:/)
    expect(source).not.toMatch(/delPattern\(`tasks:list:/)
  })
})
