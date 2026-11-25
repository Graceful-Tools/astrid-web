/**
 * ADEV-272 — Goal Signals gate and the environment's service registry.
 * Mirrors task-cost-gate.test.ts: capability off is 404, flag off is 403 not_granted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const CAPABILITIES = vi.hoisted(() => ({ goalSignals: true, projectMode: true }))
vi.mock('@/lib/brand/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand/capabilities')>('@/lib/brand/capabilities')
  return { ...actual, CAPABILITIES }
})

const isFeatureEnabled = vi.hoisted(() => vi.fn())
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled }))

import { goalSignalsGate, canUseGoalSignals, goalSignalsCompiledIn, GOAL_SIGNALS_FEATURE_KEY } from '@/lib/goal-signals'
import { GOAL_SIGNALS_FEATURE_KEY as SHARED_KEY } from '@/lib/goal-signals-shared'
import { goalSignalsOffering, parseSignalServices } from '@/lib/goal-signal-services'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  CAPABILITIES.goalSignals = true
  isFeatureEnabled.mockResolvedValue(true)
})

describe('Goal Signals gating (ADEV-272)', () => {
  it('shares one key between server and client modules', () => {
    expect(GOAL_SIGNALS_FEATURE_KEY).toBe(SHARED_KEY)
    expect(GOAL_SIGNALS_FEATURE_KEY).toBe('goal_signals')
  })

  it('lets a granted user through', async () => {
    expect(await goalSignalsGate(USER)).toBeNull()
    expect(await canUseGoalSignals(USER)).toBe(true)
  })

  it('404s when the capability is off, without consulting the flag', async () => {
    CAPABILITIES.goalSignals = false
    const res = await goalSignalsGate(USER)
    expect(res?.status).toBe(404)
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    expect(goalSignalsCompiledIn()).toBe(false)
    expect(await canUseGoalSignals(USER)).toBe(false)
  })

  it('403s with reason not_granted when the flag is off', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const res = await goalSignalsGate(USER)
    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(body.reason).toBe('not_granted')
    expect(body.featureKey).toBe('goal_signals')
  })
})

describe('capability coherence (ADEV-272)', () => {
  it('requires Project Mode', async () => {
    vi.resetModules()
    vi.doUnmock('@/lib/brand/capabilities')
    vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_GOAL_SIGNALS', 'true')
    vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE', 'false')
    const off = await import('@/lib/brand/capabilities')
    expect(() => off.assertCoherentCapabilities()).toThrow(/Goal Signals/)

    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE', 'true')
    const on = await import('@/lib/brand/capabilities')
    expect(on.CAPABILITIES.goalSignals).toBe(true)
    expect(() => on.assertCoherentCapabilities()).not.toThrow()
    vi.unstubAllEnvs()
  })

  it('is off unless explicitly enabled', async () => {
    vi.resetModules()
    vi.doUnmock('@/lib/brand/capabilities')
    vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_GOAL_SIGNALS', '')
    const caps = await import('@/lib/brand/capabilities')
    expect(caps.CAPABILITIES.goalSignals).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe('signal service registry (ADEV-272)', () => {
  const service = { key: 'ga', kind: 'metric', name: 'Analytics', baseUrl: 'https://metrics.example.com', secretEnv: 'GA_TOKEN' }

  it('publishes nothing when the capability is off', () => {
    CAPABILITIES.goalSignals = false
    expect(goalSignalsOffering({ ASTRID_SIGNAL_SERVICES: JSON.stringify([service]) })).toEqual({
      metricSources: [],
      experimentSources: [],
      estimators: [],
      customEndpoints: false,
    })
  })

  it('offers the built-in estimator by default and no custom endpoints', () => {
    expect(goalSignalsOffering({})).toEqual({
      metricSources: [],
      experimentSources: [],
      estimators: [{ key: 'builtin', name: 'Built-in estimator' }],
      customEndpoints: false,
    })
  })

  it('groups services by kind and never publishes the URL or the secret', () => {
    const env = {
      ASTRID_SIGNAL_SERVICES: JSON.stringify([
        service,
        { ...service, key: 'gb', kind: 'experiment', name: 'Experiments' },
        { ...service, key: 'est', kind: 'estimator', name: 'Estimator' },
      ]),
      ASTRID_SIGNALS_BUILTIN_ESTIMATOR: 'false',
      ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS: 'true',
    }
    const offering = goalSignalsOffering(env)
    expect(offering).toEqual({
      metricSources: [{ key: 'ga', name: 'Analytics' }],
      experimentSources: [{ key: 'gb', name: 'Experiments' }],
      estimators: [{ key: 'est', name: 'Estimator' }],
      customEndpoints: true,
    })
    expect(JSON.stringify(offering)).not.toMatch(/example\.com|GA_TOKEN/)
  })

  it('drops malformed entries, non-https URLs and duplicate keys; bad JSON offers nothing', () => {
    expect(parseSignalServices('not json')).toEqual([])
    expect(parseSignalServices('{"a":1}')).toEqual([])
    const parsed = parseSignalServices(JSON.stringify([
      service,
      { ...service, name: 'dup' },
      { ...service, key: 'http', baseUrl: 'http://insecure.example.com' },
      { ...service, key: 'kind', kind: 'other' },
      { ...service, key: 'nosecret', secretEnv: '' },
      { ...service, key: 'builtin' },
      null,
    ]))
    expect(parsed.map(s => s.key)).toEqual(['ga'])
  })
})
