/**
 * Task f9ba26b3 — the bounded-parallelism helper the cron loops run on.
 *
 * The cases that matter are the error ones. The GitHub sync driver commits its
 * `since` watermark only when apply returns without throwing, so a helper that
 * loses an error, or that lets a rejection escape after the caller has moved
 * on, converts a retryable failure into issues that are never offered again.
 */

import { describe, it, expect, vi } from 'vitest'
import { mapWithConcurrency } from '@/lib/concurrency'

/** Resolves only when `release()` is called, so overlap can be observed. */
function deferred<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>(resolve => {
    release = resolve
  })
  return { promise, release }
}

describe('mapWithConcurrency (task f9ba26b3)', () => {
  it('returns results in INPUT order, not completion order', async () => {
    // The results feed a tally; an order that depends on timing would make the
    // caller's accounting non-deterministic.
    const result = await mapWithConcurrency([30, 10, 20], 3, async ms => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return ms
    })

    expect(result).toEqual([30, 10, 20])
  })

  it('never runs more than `limit` at once', async () => {
    let inFlight = 0
    let peak = 0

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
      return null
    })

    expect(peak).toBe(4)
  })

  it('keeps workers saturated rather than running in lockstep chunks', async () => {
    // The difference between this and a chunked Promise.all: with one slow item
    // in a chunk of two, chunking idles the other worker until it finishes, so
    // the fourth item cannot start. Here it can.
    const slow = deferred<void>()
    const started: number[] = []

    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (_item, index) => {
      started.push(index)
      if (index === 0) await slow.promise
      return index
    })

    await new Promise(resolve => setImmediate(resolve))

    // 0 is parked; 1, 2 and 3 should have flowed through the free worker.
    expect(started).toContain(3)

    slow.release()
    await run
  })

  it('rethrows the original error object, not a wrapper', async () => {
    // apply-issues decides "concurrent create" vs "real failure" by reading
    // `error.code`. A wrapped or re-created error would make every P2002 look
    // like a hard failure — and every hard failure look absorbable.
    const original = Object.assign(new Error('unique'), { code: 'P2002' })

    await expect(
      mapWithConcurrency([1], 2, async () => {
        throw original
      }),
    ).rejects.toBe(original)
  })

  it('reports the FIRST failure when several fail', async () => {
    const error = await mapWithConcurrency([1, 2, 3], 1, async item => {
      if (item >= 2) throw new Error(`failed on ${item}`)
      return item
    }).catch((err: Error) => err)

    expect((error as Error).message).toBe('failed on 2')
  })

  it('stops starting new work once something has failed', async () => {
    const fn = vi.fn(async (item: number) => {
      if (item === 0) throw new Error('boom')
      return item
    })

    await expect(mapWithConcurrency([0, 1, 2, 3, 4, 5], 1, fn)).rejects.toThrow('boom')

    // The caller is going to discard this pass; the remaining items are waste.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('AWAITS work already in flight before it throws', async () => {
    // Otherwise a write lands after the caller has decided the pass failed, and
    // its rejection surfaces as an unhandled rejection with no owner.
    const slow = deferred<void>()
    let slowFinished = false

    const run = mapWithConcurrency([0, 1], 2, async (_item, index) => {
      if (index === 0) {
        throw new Error('fast failure')
      }
      await slow.promise
      slowFinished = true
      return index
    })

    const settled = run.catch((err: Error) => err)
    await new Promise(resolve => setImmediate(resolve))

    slow.release()
    const error = await settled

    expect((error as Error).message).toBe('fast failure')
    expect(slowFinished).toBe(true)
  })

  it('handles an empty list without calling the worker', async () => {
    const fn = vi.fn()
    expect(await mapWithConcurrency([], 5, fn)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not hang on a limit of zero', async () => {
    // A width of 0 would spawn no workers and await nothing — a silent no-op
    // that returns a list of holes.
    expect(await mapWithConcurrency([1, 2], 0, async item => item * 2)).toEqual([2, 4])
  })
})
