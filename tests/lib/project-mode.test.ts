/**
 * Regression tests for tasks dd7172d8 / e627f967 — the two-layer Project Mode
 * gate. The ordering (capability before flag) is the security-relevant part:
 * a deployment that compiled the feature out must not be reachable by flipping
 * a runtime flag.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const isFeatureEnabled = vi.hoisted(() => vi.fn())
const capabilities = vi.hoisted(() => ({ projectMode: true }))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled,
  FEATURE_KEYS: ['google_tasks', 'project_mode'],
}))

vi.mock('@/lib/brand/capabilities', () => ({
  get CAPABILITIES() {
    return capabilities
  },
}))

import { canUseProjectMode, projectModeGate, projectModeCompiledIn } from '@/lib/project-mode'

describe('Project Mode gate (dd7172d8, e627f967)', () => {
  beforeEach(() => {
    capabilities.projectMode = true
    isFeatureEnabled.mockReset()
  })
  afterEach(() => {
    capabilities.projectMode = true
  })

  describe('canUseProjectMode', () => {
    it('is true only when the capability is on AND the user has the flag', async () => {
      isFeatureEnabled.mockResolvedValue(true)
      await expect(canUseProjectMode('user-1')).resolves.toBe(true)
    })

    it('is false when the user lacks the flag', async () => {
      isFeatureEnabled.mockResolvedValue(false)
      await expect(canUseProjectMode('user-1')).resolves.toBe(false)
    })

    it('is false when the capability is compiled out, without consulting the flag', async () => {
      // The ordering guarantee: a deployment that disabled Project Mode must not
      // even ask the flag service, so no runtime configuration can resurrect it.
      capabilities.projectMode = false
      isFeatureEnabled.mockResolvedValue(true)

      await expect(canUseProjectMode('user-1')).resolves.toBe(false)
      expect(isFeatureEnabled).not.toHaveBeenCalled()
    })
  })

  describe('projectModeCompiledIn', () => {
    it('reflects the build-time capability', () => {
      expect(projectModeCompiledIn()).toBe(true)
      capabilities.projectMode = false
      expect(projectModeCompiledIn()).toBe(false)
    })
  })

  describe('projectModeGate', () => {
    it('returns null when the user may proceed', async () => {
      isFeatureEnabled.mockResolvedValue(true)
      await expect(projectModeGate('user-1')).resolves.toBeNull()
    })

    it('404s when the capability is off so the feature looks absent, not forbidden', async () => {
      capabilities.projectMode = false
      const response = await projectModeGate('user-1')
      expect(response?.status).toBe(404)
    })

    it('403s with a machine-readable reason when the user simply has not been granted it', async () => {
      // Distinct from 404 on purpose: the feature exists here, so the client
      // should render the request-access affordance rather than a dead end.
      isFeatureEnabled.mockResolvedValue(false)
      const response = await projectModeGate('user-1')

      expect(response?.status).toBe(403)
      await expect(response!.json()).resolves.toMatchObject({
        reason: 'not_granted',
        featureKey: 'project_mode',
      })
    })
  })
})
