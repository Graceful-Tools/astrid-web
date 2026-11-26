// @vitest-environment node
/**
 * astrid-core decides repeating-task rollover on the server (AWTD-1063) and there is no TypeScript
 * behind it (ADEV-306). Whatever the core does short of answering (cannot load, throws, answers
 * garbage or an error envelope), nextOccurrenceForTask REFUSES with a retryable error: a completion
 * fails and can be retried, and no guessed date is ever written.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  nextOccurrenceForTask,
  RolloverUnavailableError,
  setRepeatingCore,
  type RepeatingCore,
} from '@/lib/repeating-rollover'
import { createRepeatingCore, installRepeatingCore, repeatingCoreStatus } from '@/lib/core-rules/repeating-core'
import type { TaskNextOccurrenceInput } from '@/types/repeating'

function silentReporter() {
  return { failure: vi.fn() }
}

const DAILY: TaskNextOccurrenceInput = {
  repeating: 'daily',
  pattern: null,
  currentDueDate: '2026-03-07T17:00:00Z',
  completion: '2026-03-07T18:00:00Z',
  repeatFrom: 'DUE_DATE',
  occurrenceCount: 0,
  timeZone: 'America/Los_Angeles',
  isAllDay: false,
}
// The core's answer for DAILY: 9am PDT the next day.
const EXPECTED = '2026-03-08T16:00:00.000Z'

const answering = (value: Record<string, unknown>) => vi.fn((_request: string) => JSON.stringify({ ok: true, value }))

afterEach(() => {
  setRepeatingCore(null)
  vi.doUnmock('@/lib/core-rules/wasm')
  vi.resetModules()
})

describe('the core decides', () => {
  it('returns the core answer', () => {
    const core = answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 9 })
    const hook = createRepeatingCore(core, silentReporter())
    setRepeatingCore(hook.next)

    expect(nextOccurrenceForTask(DAILY)).toEqual({ nextDueDate: '2030-01-01T00:00:00.000Z', shouldTerminate: false, newOccurrenceCount: 9 })
    const request = JSON.parse(core.mock.calls[0][0])
    expect(request).toEqual({
      kind: 'nextOccurrence',
      repeating: 'daily',
      pattern: null,
      currentDueDate: '2026-03-07T17:00:00Z',
      completion: '2026-03-07T18:00:00Z',
      repeatFrom: 'DUE_DATE',
      occurrenceCount: 0,
      timeZone: 'America/Los_Angeles',
      isAllDay: false,
    })
    expect(hook.stats).toEqual({ answered: 1, skipped: 0, failed: 0 })
  })

  it('sends Dates as ISO strings and an absent zone as UTC', () => {
    const core = answering({ nextDueDate: '2026-03-08T17:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 })
    setRepeatingCore(createRepeatingCore(core, silentReporter()).next)
    nextOccurrenceForTask({ ...DAILY, currentDueDate: new Date('2026-03-07T17:00:00Z'), completion: new Date('2026-03-07T18:00:00Z'), timeZone: null })
    const request = JSON.parse(core.mock.calls[0][0])
    expect(request).toMatchObject({ currentDueDate: '2026-03-07T17:00:00.000Z', completion: '2026-03-07T18:00:00.000Z', timeZone: 'UTC' })
  })

  it('keeps the milliseconds-free core date as an ISO instant', () => {
    const hook = createRepeatingCore(answering({ nextDueDate: '2026-03-08T16:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 }), silentReporter())
    setRepeatingCore(hook.next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(EXPECTED)
  })

  it('in shadow mode still asks the core: no TypeScript is left to decide', () => {
    const core = answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 })
    const hook = createRepeatingCore(core, silentReporter(), { mode: 'shadow' })
    setRepeatingCore(hook.next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe('2030-01-01T00:00:00.000Z')
    expect(hook.stats).toEqual({ answered: 1, skipped: 0, failed: 0 })
  })
})

describe('the rollover is refused whenever the core cannot give an answer (ADEV-306)', () => {
  const cases: Array<[string, (request: string) => string]> = [
    ['an error envelope', () => JSON.stringify({ ok: false, error: { kind: 'badRequest' } })],
    ['not JSON', () => 'nonsense'],
    ['a missing field', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z' } })],
    ['a date that is not a date', () => JSON.stringify({ ok: true, value: { nextDueDate: 'soon', shouldTerminate: false, newOccurrenceCount: 1 } })],
    ['no date for a series that goes on', () => JSON.stringify({ ok: true, value: { nextDueDate: null, shouldTerminate: false, newOccurrenceCount: 1 } })],
    ['a date for a series that ended', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: true, newOccurrenceCount: 1 } })],
    ['a count that is not a whole number', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1.5 } })],
  ]

  it('refuses when no core is installed, with a retryable error', () => {
    setRepeatingCore(null)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
    try {
      nextOccurrenceForTask(DAILY)
    } catch (error) {
      expect((error as RolloverUnavailableError).retryable).toBe(true)
    }
  })

  it.each(cases)('%s', (_name, runJson) => {
    const report = silentReporter()
    const hook = createRepeatingCore(runJson, report)
    setRepeatingCore(hook.next)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
    expect(hook.stats.failed).toBe(1)
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('switches a core that throws off for the rest of the process', () => {
    const runJson = vi.fn(() => {
      throw new Error('unreachable')
    })
    const hook = createRepeatingCore(runJson, silentReporter())
    setRepeatingCore(hook.next)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(hook.stats.failed).toBe(2)
  })

  it('refuses a hook that itself throws, or answers something that is not an answer', () => {
    setRepeatingCore(() => {
      throw new Error('boom')
    })
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
    setRepeatingCore((() => ({ nonsense: true })) as unknown as RepeatingCore)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
  })

  it('survives a reporter that throws', () => {
    const report = {
      failure: () => {
        throw new Error('log down')
      },
    }
    setRepeatingCore(createRepeatingCore(answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 }), report).next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe('2030-01-01T00:00:00.000Z')
    setRepeatingCore(createRepeatingCore(() => 'nonsense', report).next)
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
  })
})

describe('installRepeatingCore (instrumentation.ts)', () => {
  it('loads nothing with ASTRID_CORE_RULES=off, and says so on /api/health', () => {
    expect(installRepeatingCore('off')).toBe(false)
    expect(repeatingCoreStatus()).toEqual({ mode: 'off', compare: 'retired', loaded: false, revision: null, stats: null })
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
  })

  it('installs the vendored core by default and reports its revision', () => {
    expect(installRepeatingCore(undefined)).toBe(true)
    const status = repeatingCoreStatus()
    expect(status).toMatchObject({ mode: 'decide', loaded: true })
    expect(status?.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(EXPECTED)
    expect(repeatingCoreStatus()?.stats).toEqual({ answered: 1, skipped: 0, failed: 0 })
  })

  it('installs in shadow mode when asked, and still answers', () => {
    expect(installRepeatingCore('shadow')).toBe(true)
    expect(repeatingCoreStatus()).toMatchObject({ mode: 'shadow', loaded: true })
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(EXPECTED)
  })

  it('refuses rollovers when the vendored build does not load', async () => {
    vi.doMock('@/lib/core-rules/wasm', () => ({ loadCoreRules: () => null }))
    const fresh = await import('@/lib/core-rules/repeating-core')
    expect(fresh.installRepeatingCore(undefined)).toBe(false)
    expect(fresh.repeatingCoreStatus()).toMatchObject({ mode: 'decide', loaded: false })
    expect(() => nextOccurrenceForTask(DAILY)).toThrow(RolloverUnavailableError)
  })

  it('never throws when loading itself throws', async () => {
    vi.doMock('@/lib/core-rules/wasm', () => ({
      loadCoreRules: () => {
        throw new Error('disk gone')
      },
    }))
    const fresh = await import('@/lib/core-rules/repeating-core')
    expect(fresh.installRepeatingCore(undefined)).toBe(false)
  })
})
