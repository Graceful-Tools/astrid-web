/**
 * RED for task 9b794349.
 *
 * Vercel freezes an invocation once its response is flushed, so a bare floating
 * promise is work that may or may not finish. The codebase had no `after` or
 * `waitUntil` outside middleware and deferred analytics, stats, webhook fan-out
 * and AI agent dispatch this way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const after = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ after }))

const { runAfterResponse } = await import('@/lib/background')

beforeEach(() => vi.clearAllMocks())

describe('runAfterResponse', () => {
  it('hands the work to the platform so it outlives the response', async () => {
    const work = vi.fn().mockResolvedValue(undefined)

    runAfterResponse('analytics', work)

    expect(after).toHaveBeenCalledTimes(1)
    await (after.mock.calls[0][0] as () => Promise<void>)()
    expect(work).toHaveBeenCalled()
  })

  it('swallows a failure rather than surfacing it on a sent response', async () => {
    after.mockImplementation((fn: () => Promise<void>) => fn())
    const work = vi.fn().mockRejectedValue(new Error('boom'))

    expect(() => runAfterResponse('webhook', work)).not.toThrow()
  })

  it('still runs the work outside a request scope, where after() throws', async () => {
    after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope')
    })
    let ran = false
    const work = vi.fn().mockImplementation(async () => {
      ran = true
    })

    runAfterResponse('cron', work)
    await vi.waitFor(() => expect(ran).toBe(true))
  })
})
