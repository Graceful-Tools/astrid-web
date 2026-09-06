/**
 * RED for task f9ba26b3-7e2c-47ba-aa01-88b419aa8deb.
 *
 * Every legacy /api/* request fired a beacon — a second HTTP request into the
 * app, which then upserts — roughly doubling invocations while iOS is still on
 * legacy routes.
 *
 * Sampling this is not as simple as "send 1 in N". summarizeLegacyUsage marks a
 * route safeToDelete only when it recorded ZERO hits in the window, so a
 * low-traffic route sampled out looks dead and gets deleted. The decision
 * therefore has to guarantee at least one beacon per (route, method) per
 * instance, and weight the sampled ones so the counts stay unbiased estimates
 * rather than a tenth of the truth.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { decideLegacyBeacon, BEACON_SAMPLE_RATE, resetBeaconMemoryForTests } from '@/lib/legacy-api-usage'

beforeEach(() => resetBeaconMemoryForTests())

describe('decideLegacyBeacon (task f9ba26b3)', () => {
  it('always sends the first hit for a route, so a live route can never look dead', () => {
    // random() = 0.99 would lose every sampling coin toss.
    const decision = decideLegacyBeacon('/api/tasks', 'GET', () => 0.99)
    expect(decision.send).toBe(true)
    expect(decision.weight).toBe(1)
  })

  it('counts a first hit as exactly one, not as a sample', () => {
    expect(decideLegacyBeacon('/api/tasks', 'GET', () => 0).weight).toBe(1)
  })

  it('treats each method as its own route, so a rare DELETE is not hidden by GETs', () => {
    decideLegacyBeacon('/api/tasks', 'GET', () => 0.99)
    expect(decideLegacyBeacon('/api/tasks', 'DELETE', () => 0.99).send).toBe(true)
  })

  it('collapses id segments, so one task id cannot use up another route’s first hit', () => {
    decideLegacyBeacon('/api/tasks/11111111-1111-1111-1111-111111111111', 'GET', () => 0.99)
    const second = decideLegacyBeacon('/api/tasks/22222222-2222-2222-2222-222222222222', 'GET', () => 0.99)
    expect(second.send).toBe(false)
  })

  it('samples subsequent hits, and weights them so the counts stay unbiased', () => {
    decideLegacyBeacon('/api/tasks', 'GET', () => 0.99) // first, always sent

    expect(decideLegacyBeacon('/api/tasks', 'GET', () => 0.99).send).toBe(false)

    const sampled = decideLegacyBeacon('/api/tasks', 'GET', () => 0)
    expect(sampled.send).toBe(true)
    expect(sampled.weight).toBe(BEACON_SAMPLE_RATE)
  })

  it('cuts beacons by roughly the sample rate over many hits', () => {
    let sent = 0
    for (let i = 0; i < 10_000; i++) {
      if (decideLegacyBeacon('/api/tasks', 'GET', Math.random).send) sent++
    }
    const expected = 10_000 / BEACON_SAMPLE_RATE
    expect(sent).toBeGreaterThan(expected * 0.7)
    expect(sent).toBeLessThan(expected * 1.3)
  })
})
