// @vitest-environment node
/**
 * astrid-core decides repeating-task rollover on the server (AWTD-1063) — and fails safe. Whatever
 * the core does short of answering (cannot load, throws, answers garbage or an error envelope),
 * nextOccurrenceForTask returns the TypeScript answer, and nothing escapes to the completion. When
 * it does answer, its answer is returned, and a disagreement is logged without ids, dates, pattern
 * values or the zone's name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextOccurrenceForTask, setRepeatingCore, type RepeatingCore } from '@/lib/repeating-rollover'
import { createRepeatingCore, installRepeatingCore, repeatingCoreStatus } from '@/lib/core-rules/repeating-core'
import type { TaskNextOccurrenceInput } from '@/types/repeating'

function silentReporter() {
  return { disagreement: vi.fn(), failure: vi.fn() }
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
// The TypeScript's answer for DAILY: 9am PDT the next day.
const TYPESCRIPT = '2026-03-08T16:00:00.000Z'

const answering = (value: Record<string, unknown>) => vi.fn(() => JSON.stringify({ ok: true, value }))

afterEach(() => {
  setRepeatingCore(null)
  vi.doUnmock('@/lib/core-rules/wasm')
  vi.resetModules()
})

describe('the core decides', () => {
  it('returns the core answer, not the TypeScript one, in decide mode', () => {
    const core = answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 9 })
    const hook = createRepeatingCore(core, silentReporter())
    setRepeatingCore(hook.next)

    expect(nextOccurrenceForTask(DAILY)).toEqual({ nextDueDate: '2030-01-01T00:00:00.000Z', shouldTerminate: false, newOccurrenceCount: 9 })
    const request = JSON.parse(core.mock.calls[0][0] as unknown as string)
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
    expect(hook.stats).toMatchObject({ disagreed: 1, agreed: 0, failed: 0 })
  })

  it('sends Dates as ISO strings and an absent zone as UTC', () => {
    const core = answering({ nextDueDate: '2026-03-08T17:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 })
    setRepeatingCore(createRepeatingCore(core, silentReporter()).next)
    nextOccurrenceForTask({ ...DAILY, currentDueDate: new Date('2026-03-07T17:00:00Z'), completion: new Date('2026-03-07T18:00:00Z'), timeZone: null })
    const request = JSON.parse(core.mock.calls[0][0] as unknown as string)
    expect(request).toMatchObject({ currentDueDate: '2026-03-07T17:00:00.000Z', completion: '2026-03-07T18:00:00.000Z', timeZone: 'UTC' })
  })

  it('counts agreement when the core answers as the TypeScript does, milliseconds or not', () => {
    const hook = createRepeatingCore(answering({ nextDueDate: '2026-03-08T16:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 }), silentReporter())
    setRepeatingCore(hook.next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(hook.stats).toMatchObject({ agreed: 1, disagreed: 0 })
  })

  it('reports a disagreement by field and shape, never ids, dates, values or the zone name', () => {
    const report = silentReporter()
    const core = answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 })
    setRepeatingCore(createRepeatingCore(core, report).next)

    nextOccurrenceForTask({ ...DAILY, repeating: 'custom', pattern: { type: 'custom', unit: 'weeks', interval: 1, weekdays: ['monday'], endCondition: 'never' } })
    nextOccurrenceForTask({ ...DAILY, repeating: 'custom', pattern: { type: 'custom', unit: 'weeks', interval: 1, weekdays: ['friday'], endCondition: 'never' } }) // same shape: logged once

    expect(report.disagreement).toHaveBeenCalledTimes(1)
    const details = report.disagreement.mock.calls[0][0]
    expect(details).toMatchObject({ rule: 'nextOccurrence', differing: ['nextDueDate'], kind: 'custom:weeks', allDay: false, zoned: true, returned: 'core' })
    expect(JSON.stringify(details)).not.toMatch(/2026|2030|Los_Angeles|monday|friday/)
  })

  it('keeps the TypeScript answer in shadow mode, and still compares', () => {
    const report = silentReporter()
    const core = answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 })
    setRepeatingCore(createRepeatingCore(core, report, { mode: 'shadow' }).next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(report.disagreement).toHaveBeenCalledWith(expect.objectContaining({ returned: 'typescript' }))
  })
})

describe('the TypeScript answer stands whenever the core cannot give one', () => {
  const cases: Array<[string, (request: string) => string]> = [
    ['an error envelope', () => JSON.stringify({ ok: false, error: { kind: 'badRequest' } })],
    ['not JSON', () => 'nonsense'],
    ['a missing field', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z' } })],
    ['a date that is not a date', () => JSON.stringify({ ok: true, value: { nextDueDate: 'soon', shouldTerminate: false, newOccurrenceCount: 1 } })],
    ['no date for a series that goes on', () => JSON.stringify({ ok: true, value: { nextDueDate: null, shouldTerminate: false, newOccurrenceCount: 1 } })],
    ['a date for a series that ended', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: true, newOccurrenceCount: 1 } })],
    ['a count that is not a whole number', () => JSON.stringify({ ok: true, value: { nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1.5 } })],
  ]

  it.each(cases)('%s', (_name, runJson) => {
    const report = silentReporter()
    const hook = createRepeatingCore(runJson, report)
    setRepeatingCore(hook.next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(hook.stats.failed).toBe(1)
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('switches a core that throws off for the rest of the process', () => {
    const runJson = vi.fn(() => {
      throw new Error('unreachable')
    })
    const hook = createRepeatingCore(runJson, silentReporter())
    setRepeatingCore(hook.next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(hook.stats.failed).toBe(2)
  })

  it('survives a hook that itself throws, or answers something that is not an answer', () => {
    setRepeatingCore(() => {
      throw new Error('boom')
    })
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    setRepeatingCore((() => ({ nonsense: true })) as unknown as RepeatingCore)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
  })

  it('survives a reporter that throws', () => {
    const report = {
      disagreement: () => {
        throw new Error('log down')
      },
      failure: () => {
        throw new Error('log down')
      },
    }
    setRepeatingCore(createRepeatingCore(answering({ nextDueDate: '2030-01-01T00:00:00Z', shouldTerminate: false, newOccurrenceCount: 1 }), report).next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe('2030-01-01T00:00:00.000Z')
    setRepeatingCore(createRepeatingCore(() => 'nonsense', report).next)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
  })
})

describe('installRepeatingCore (instrumentation.ts)', () => {
  it('loads nothing with ASTRID_CORE_RULES=off, and says so on /api/health', () => {
    expect(installRepeatingCore('off')).toBe(false)
    expect(repeatingCoreStatus()).toEqual({ mode: 'off', loaded: false, revision: null, stats: null })
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
  })

  it('installs the vendored core by default and reports its revision', () => {
    expect(installRepeatingCore(undefined)).toBe(true)
    const status = repeatingCoreStatus()
    expect(status).toMatchObject({ mode: 'decide', loaded: true })
    expect(status?.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
    expect(repeatingCoreStatus()?.stats).toMatchObject({ agreed: 1 })
  })

  it('installs in shadow mode when asked', () => {
    expect(installRepeatingCore('shadow')).toBe(true)
    expect(repeatingCoreStatus()).toMatchObject({ mode: 'shadow', loaded: true })
  })

  it('falls back to the TypeScript when the vendored build does not load', async () => {
    vi.doMock('@/lib/core-rules/wasm', () => ({ loadCoreRules: () => null }))
    const fresh = await import('@/lib/core-rules/repeating-core')
    expect(fresh.installRepeatingCore(undefined)).toBe(false)
    expect(fresh.repeatingCoreStatus()).toMatchObject({ mode: 'decide', loaded: false })
    expect(nextOccurrenceForTask(DAILY).nextDueDate).toBe(TYPESCRIPT)
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
