/**
 * ADEV-279: the server offers the Pending results preset only while goal signals are on for the
 * board's project (its owner), and adding Testing never depends on the gate. Nothing else adds the
 * column: this is the one path, and a person takes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({ project: { findUnique: vi.fn(), update: vi.fn() } }))
const canUseGoalSignals = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/goal-signals', () => ({ canUseGoalSignals }))

import { addUserPresetStatus } from '@/lib/projects-service'

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.project.findUnique.mockResolvedValue({ customStates: [], ownerId: 'owner' })
  prismaMock.project.update.mockResolvedValue({})
})

describe('addUserPresetStatus (ADEV-279)', () => {
  it('refuses Pending results while goal signals are off for the board’s project', async () => {
    canUseGoalSignals.mockResolvedValue(false)
    const out = await addUserPresetStatus('someone', 'results', 'p1')
    expect(out).toMatchObject({ error: expect.any(String) })
    expect(canUseGoalSignals).toHaveBeenCalledWith('owner')
    expect(prismaMock.project.update).not.toHaveBeenCalled()
  })

  it('adds Pending results with its fixed role while the gate is on', async () => {
    canUseGoalSignals.mockResolvedValue(true)
    const out = await addUserPresetStatus('someone', 'results', 'p1')
    expect(out).toMatchObject({ state: { role: 'results', name: 'Pending results' } })
    expect(prismaMock.project.update).toHaveBeenCalledTimes(1)
  })

  it('adds Testing whatever the gate says', async () => {
    canUseGoalSignals.mockResolvedValue(false)
    const out = await addUserPresetStatus('someone', 'testing', 'p1')
    expect(out).toMatchObject({ state: { role: 'testing' } })
  })
})
