/**
 * AWTD-1660 — the allowlist that grants `project_mode` on top of the admin
 * grants from astrid.cc/admin.
 *
 * The list is configuration (PROJECT_MODE_ALLOWLIST_EMAILS), never a personal
 * address in code: a whitelabel fork would inherit it (check:reuse,
 * hardcoded-identity). It is applied where the per-user flags are evaluated
 * (getEffectiveFeatures), so the web client (/api/v1/features), iOS and every
 * server gate (projectModeGate → isFeatureEnabled) agree. It never overrides
 * the build-time capability: lib/project-mode.ts checks that first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  featureFlag: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { getEffectiveFeatures, isFeatureEnabled, invalidateFeatureFlagCache } from '@/lib/feature-flags'
import { isProjectModeAllowlisted, projectModeAllowlist } from '@/lib/project-mode-allowlist'

const ALLOWED = 'builder@example.com'
const verified = new Date('2026-01-01')

describe('project_mode allowlist (AWTD-1660)', () => {
  const saved = process.env.PROJECT_MODE_ALLOWLIST_EMAILS
  beforeEach(() => {
    process.env.PROJECT_MODE_ALLOWLIST_EMAILS = ` ${ALLOWED.toUpperCase()} , second@example.com,`
    invalidateFeatureFlagCache()
    prismaMock.featureFlag.findMany.mockReset().mockResolvedValue([])
    prismaMock.user.findUnique.mockReset()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.PROJECT_MODE_ALLOWLIST_EMAILS
    else process.env.PROJECT_MODE_ALLOWLIST_EMAILS = saved
  })

  it('reads a comma-separated, lower-cased list from the environment', () => {
    expect(projectModeAllowlist()).toEqual([ALLOWED, 'second@example.com'])
  })

  it('unset means nobody', () => {
    delete process.env.PROJECT_MODE_ALLOWLIST_EMAILS
    expect(projectModeAllowlist()).toEqual([])
    expect(isProjectModeAllowlisted(ALLOWED)).toBe(false)
  })

  it('matches emails case-insensitively and refuses empty input', () => {
    expect(isProjectModeAllowlisted(ALLOWED.toUpperCase())).toBe(true)
    expect(isProjectModeAllowlisted(`  ${ALLOWED} `)).toBe(true)
    expect(isProjectModeAllowlisted('someone-else@example.com')).toBe(false)
    expect(isProjectModeAllowlisted(null)).toBe(false)
    expect(isProjectModeAllowlisted('')).toBe(false)
  })

  it('an allowlisted, verified email gets project_mode with no admin grant', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: ALLOWED, emailVerified: verified })
    const effective = await getEffectiveFeatures('user-allow')
    expect(effective.features.project_mode).toBe(true)
    await expect(isFeatureEnabled('project_mode', 'user-allow')).resolves.toBe(true)
  })

  it('an allowlisted but UNVERIFIED account does not (a passkey signup is not proof)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: ALLOWED, emailVerified: null })
    const effective = await getEffectiveFeatures('user-unverified')
    expect(effective.features.project_mode).toBe(false)
  })

  it('anyone else without a grant does not', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'someone-else@example.com', emailVerified: verified })
    const effective = await getEffectiveFeatures('user-other')
    expect(effective.features.project_mode).toBe(false)
  })

  it('does not hand out any OTHER flag to an allowlisted email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: ALLOWED, emailVerified: verified })
    const effective = await getEffectiveFeatures('user-allow')
    expect(effective.features.google_tasks).toBe(false)
    expect(effective.features.task_cost).toBe(false)
  })

  it('skips the email lookup when the admin grant already applies', async () => {
    prismaMock.featureFlag.findMany.mockResolvedValue([
      { key: 'project_mode', enabled: true, rolloutMode: 'ALL', rolloutPercentage: 0, targets: [], updatedAt: new Date() },
    ])
    const effective = await getEffectiveFeatures('user-granted')
    expect(effective.features.project_mode).toBe(true)
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })

  it('fails closed when the email lookup throws', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'))
    const effective = await getEffectiveFeatures('user-x')
    expect(effective.features.project_mode).toBe(false)
  })
})
