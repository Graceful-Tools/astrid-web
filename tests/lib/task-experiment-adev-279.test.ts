/**
 * ADEV-279: an experiment service's reply is untrusted data read as given (Astrid computes no
 * statistics), a verification compares the baseline recorded at deploy with what the project's
 * sources hold at `decideBy`, and unknown is never a pass.
 */
import { describe, it, expect } from 'vitest'
import {
  captureBaseline,
  compareVerification,
  decideByFromDays,
  sanitizeExperimentReply,
  storedBaseline,
  toResultCondition,
} from '@/lib/task-experiment'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

const NOW = new Date('2026-11-26T12:00:00Z')
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString()

const reply = (entry: Record<string, unknown>) => ({ experiments: [{ key: 'exp-1', at: iso(1), state: 'running', ...entry }] })

describe('sanitizeExperimentReply (ADEV-279)', () => {
  it('keeps the service’s numbers, verdict and recommendation as given', () => {
    const reading = sanitizeExperimentReply(
      reply({
        verdict: 'improving',
        url: 'https://exp.example.com/412',
        recommendation: { action: 'ship', reason: 'significant lift' },
        metrics: [{ metricKey: 'conv', goalId: 'g1', control: 6, treatment: 6.4, relDelta: 0.067, ci: [0.01, 0.12], significant: true }],
      }),
      'exp-1',
      NOW,
    )
    expect(reading).toMatchObject({
      state: 'running',
      verdict: 'improving',
      url: 'https://exp.example.com/412',
      recommendation: { action: 'ship', reason: 'significant lift' },
      metrics: [{ metricKey: 'conv', goalId: 'g1', control: 6, treatment: 6.4, relDelta: 0.067, ci: [0.01, 0.12], significant: true }],
    })
  })

  it('drops what is not the contract instead of guessing', () => {
    const reading = sanitizeExperimentReply(
      reply({
        state: 'exploding',
        verdict: 'amazing',
        url: 'http://insecure.example.com',
        recommendation: { action: 'delete-everything', reason: 'x' },
        metrics: [{ metricKey: '' }, { metricKey: 'm', control: 'NaN', ci: [1] }, 'junk'],
      }),
      'exp-1',
      NOW,
    )
    expect(reading).toMatchObject({ state: 'unknown', verdict: null, url: null, recommendation: null, metrics: [{ metricKey: 'm' }] })
  })

  it('answers null for a reply that is not about the key, or whose `at` is unreadable or in the future', () => {
    expect(sanitizeExperimentReply({ experiments: [{ key: 'other', at: iso(1), state: 'running' }] }, 'exp-1', NOW)).toBeNull()
    expect(sanitizeExperimentReply(reply({ at: 'yesterday-ish' }), 'exp-1', NOW)).toBeNull()
    expect(sanitizeExperimentReply(reply({ at: new Date(NOW.getTime() + 3_600_000).toISOString() }), 'exp-1', NOW)).toBeNull()
    expect(sanitizeExperimentReply('nope', 'exp-1', NOW)).toBeNull()
  })

  it('clips a long recommendation reason', () => {
    const reading = sanitizeExperimentReply(reply({ recommendation: { action: 'stop', reason: 'x'.repeat(5000) } }), 'exp-1', NOW)
    expect(reading?.recommendation?.reason.length).toBe(500)
  })
})

const stated = (over: { goalCurrent?: number; goalAt?: string; railCurrent?: number; railAt?: string } = {}): GoalsAndGuardrails => ({
  goals: [
    {
      id: 'g1',
      statement: 'Convert more',
      measure: 'Checkout conversion',
      metric: { direction: 'up', unit: '%', current: over.goalCurrent, measuredAt: over.goalAt, source: { connectorId: 'c1', metricKey: 'conv' } },
    },
  ],
  guardrails: [
    {
      id: 'r1',
      statement: 'p95 latency stays low',
      kind: 'enforced',
      check: { type: 'metric', source: { connectorId: 'c1', metricKey: 'p95' }, op: '<=', threshold: 400, current: over.railCurrent, measuredAt: over.railAt },
    },
  ],
})

describe('verification (ADEV-279)', () => {
  const baseline = captureBaseline(stated({ goalCurrent: 6, goalAt: iso(30), railCurrent: 300, railAt: iso(30) }), new Date(NOW.getTime() - 30 * 3_600_000))

  it('records only fresh readings as the baseline', () => {
    expect(baseline.goals).toEqual([{ id: 'g1', value: 6, at: iso(30) }])
    expect(baseline.guardrails).toEqual([{ id: 'r1', value: 300, at: iso(30) }])
    const none = captureBaseline(stated({ goalCurrent: 6, goalAt: iso(500), railCurrent: 300 }), NOW)
    expect(none.goals).toEqual([])
    expect(none.guardrails).toEqual([])
    expect(storedBaseline(JSON.parse(JSON.stringify(baseline)))).toEqual(baseline)
    expect(storedBaseline('junk')).toBeNull()
  })

  it('passes when no guardrail is breached and no goal regressed', () => {
    const result = compareVerification(baseline, stated({ goalCurrent: 6.4, goalAt: iso(1), railCurrent: 310, railAt: iso(1) }), NOW)
    expect(result.verdict).toBe('improving')
    expect(result.findings.map(f => f.outcome)).toEqual(['improved', 'held'])
  })

  it('a goal that held counts as passing, one that moved against its direction regresses', () => {
    expect(compareVerification(baseline, stated({ goalCurrent: 6, goalAt: iso(1), railCurrent: 300, railAt: iso(1) }), NOW).verdict).toBe('improving')
    const down = compareVerification(baseline, stated({ goalCurrent: 5.5, goalAt: iso(1), railCurrent: 300, railAt: iso(1) }), NOW)
    expect(down.verdict).toBe('regressing')
    expect(down.findings[0]).toMatchObject({ kind: 'goal', outcome: 'regressed', before: 6, after: 5.5 })
  })

  it('honours a goal whose direction is down', () => {
    const base = { ...baseline }
    const lower = stated({ goalCurrent: 5, goalAt: iso(1), railCurrent: 300, railAt: iso(1) })
    lower.goals[0].metric!.direction = 'down'
    expect(compareVerification(base, lower, NOW).verdict).toBe('improving')
    lower.goals[0].metric!.current = 7
    expect(compareVerification(base, lower, NOW).verdict).toBe('regressing')
  })

  it('a breached guardrail fails the window even when the goal improved', () => {
    const result = compareVerification(baseline, stated({ goalCurrent: 9, goalAt: iso(1), railCurrent: 450, railAt: iso(1) }), NOW)
    expect(result.verdict).toBe('regressing')
    expect(result.findings.find(f => f.kind === 'guardrail')).toMatchObject({ outcome: 'breached', after: 450 })
  })

  it('unknown is never a pass: no fresh reading since the deploy is inconclusive', () => {
    const stale = compareVerification(baseline, stated({ goalCurrent: 9, goalAt: iso(100), railCurrent: 300, railAt: iso(100) }), NOW)
    expect(stale.verdict).toBe('inconclusive')
    expect(stale.findings.every(f => f.outcome === 'unknown')).toBe(true)
    // A reading older than the baseline is not "since the deploy" even though it is still fresh.
    const before = compareVerification(baseline, stated({ goalCurrent: 9, goalAt: iso(40), railCurrent: 300, railAt: iso(40) }), NOW)
    expect(before.verdict).toBe('inconclusive')
    expect(compareVerification(null, stated(), NOW).verdict).toBe('inconclusive')
  })

  it('reads a window of days, within 1 to 90', () => {
    expect(decideByFromDays(7, NOW)?.toISOString()).toBe('2026-12-03T12:00:00.000Z')
    expect(decideByFromDays(0, NOW)).toBeNull()
    expect(decideByFromDays(91, NOW)).toBeNull()
    expect(decideByFromDays(Number.NaN, NOW)).toBeNull()
  })
})

describe('toResultCondition (ADEV-279)', () => {
  const row = (over: Record<string, unknown>) => ({ kind: 'experiment', state: 'running', verdict: null, decideBy: null, fetchedAt: null, ...over }) as Parameters<typeof toResultCondition>[0]

  it('reads an unfinished link as open, whatever the service said so far', () => {
    expect(toResultCondition(row({ verdict: 'improving' }))).toEqual({ kind: 'experiment', state: 'open' })
    expect(toResultCondition(row({ state: 'pending' })).state).toBe('open')
    expect(toResultCondition(row({ state: 'unknown' })).state).toBe('open')
  })

  it('reads a concluded or stopped link with its verdict; `flat` is the core’s inconclusive', () => {
    expect(toResultCondition(row({ state: 'concluded', verdict: 'improving' }))).toEqual({ kind: 'experiment', state: 'concluded', verdict: 'improving' })
    expect(toResultCondition(row({ state: 'stopped', verdict: 'regressing' }))).toMatchObject({ state: 'concluded', verdict: 'regressing' })
    expect(toResultCondition(row({ state: 'concluded', verdict: 'flat' }))).toMatchObject({ verdict: 'inconclusive' })
    expect(toResultCondition(row({ state: 'concluded' })).verdict).toBeUndefined()
  })

  it('carries the deadline and the last answer as instants', () => {
    const decideBy = new Date('2026-12-01T00:00:00Z')
    const fetchedAt = new Date('2026-11-26T11:00:00Z')
    expect(toResultCondition(row({ kind: 'verification', decideBy, fetchedAt }))).toEqual({
      kind: 'verification',
      state: 'open',
      decideBy: decideBy.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
    })
  })
})
