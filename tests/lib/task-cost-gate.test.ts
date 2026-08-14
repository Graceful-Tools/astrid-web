/**
 * Task 315949e1 — Task Cost gating.
 *
 * The spec's phase-0 done condition is two-sided: "an agent run writes a
 * TaskCostEvent, AND a user without the flag sees nothing." This covers the
 * second half.
 *
 * Deliberately a mirror of the Project Mode gate, including the distinction
 * that matters most: capability off is 404 (the feature does not exist here),
 * flag off is 403 with reason not_granted (it exists, you have not been given
 * it). Collapsing those two into one status would either lie to the user or
 * advertise a feature the deployment does not ship.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const CAPABILITIES = vi.hoisted(() => ({ taskCost: true }))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES }))

const isFeatureEnabled = vi.hoisted(() => vi.fn())
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled }))

import { taskCostGate, canUseTaskCost, taskCostCompiledIn, TASK_COST_FEATURE_KEY } from '@/lib/task-cost'
import { TASK_COST_FEATURE_KEY as SHARED_KEY } from '@/lib/task-cost-shared'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  CAPABILITIES.taskCost = true
  isFeatureEnabled.mockResolvedValue(true)
})

describe('Task Cost gating (task 315949e1)', () => {
  it('re-exports the same key the client-safe module defines', () => {
    // Two constants that could drift is exactly the bug this split is meant to
    // avoid; the client imports from the shared file, the server from here.
    expect(TASK_COST_FEATURE_KEY).toBe(SHARED_KEY)
    expect(TASK_COST_FEATURE_KEY).toBe('task_cost')
  })

  it('lets a granted user through', async () => {
    expect(await taskCostGate(USER)).toBeNull()
    expect(await canUseTaskCost(USER)).toBe(true)
  })

  it('404s when the capability is compiled out, without consulting the flag', async () => {
    // Absolute and per-deployment: no runtime flag can turn it back on, so
    // there is no reason to ask.
    CAPABILITIES.taskCost = false

    const res = await taskCostGate(USER)

    expect(res?.status).toBe(404)
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    expect(taskCostCompiledIn()).toBe(false)
  })

  it('403s with reason not_granted when the flag is off', async () => {
    // A 404 here would be a lie: the feature exists, this user has not been
    // given it — and the client turns this reason into request-access.
    isFeatureEnabled.mockResolvedValue(false)

    const res = await taskCostGate(USER)

    expect(res?.status).toBe(403)
    const body = await res!.json()
    expect(body.reason).toBe('not_granted')
    expect(body.featureKey).toBe('task_cost')
  })

  it('reports false rather than throwing when the capability is off', async () => {
    // Callers can treat "not built" and "not granted" identically; only the
    // HTTP layer distinguishes them.
    CAPABILITIES.taskCost = false

    expect(await canUseTaskCost(USER)).toBe(false)
  })

  it('checks the flag against the specific user', async () => {
    await canUseTaskCost(USER)

    expect(isFeatureEnabled).toHaveBeenCalledWith('task_cost', USER)
  })
})
