/**
 * AWTD-1118 (P6b): `resolveRepeatingTaskCompletion` is where the repeating
 * rules live for EVERY write surface (v1 and legacy both go through it), so
 * it is also where a GitHub board's series is handed over.
 *
 * Returning null means "nothing special — complete it normally", which is
 * exactly the right answer for a spawned series: the predecessor really is
 * just completed, and a `recur` job makes the successor.
 *
 * Pinned:
 *   - a GitHub-backed task is NOT rolled forward;
 *   - a personal list is unaffected;
 *   - a TERMINATING series is never handed over — it has no successor to
 *     make, and it still has to clear its own configuration;
 *   - a cancelled completion never reaches the handoff at all;
 *   - a deployment without GitHub Projects never even imports the module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const handler = vi.hoisted(() => ({ handleRepeatingTaskCompletion: vi.fn(), applyRepeatingTaskRollForward: vi.fn() }))
vi.mock('@/lib/repeating-task-handler', () => handler)

const capabilities = vi.hoisted(() => ({ hasCapability: vi.fn(() => true) }))
vi.mock('@/lib/brand/capabilities', () => capabilities)

const recurrence = vi.hoisted(() => ({
  enqueueRecurrenceSpawn: vi.fn(async () => false),
  enqueueRecurrenceForRemoteCompletions: vi.fn(),
  runRecurSpawn: vi.fn(),
}))
vi.mock('@/services/github-recurrence.service', () => recurrence)

vi.mock('@/lib/prisma', () => ({ prisma: { task: { findUnique: vi.fn() }, comment: { create: vi.fn() } } }))

import { resolveRepeatingTaskCompletion } from '@/lib/task-update-handler'

const completing = { taskId: 'task-1', existingCompleted: false, dataCompleted: true }

const rollForward = { shouldRollForward: true, shouldTerminate: false, nextDueDate: new Date('2026-10-12'), newOccurrenceCount: 4 }
const terminating = { shouldRollForward: false, shouldTerminate: true, nextDueDate: null, newOccurrenceCount: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  capabilities.hasCapability.mockReturnValue(true)
  recurrence.enqueueRecurrenceSpawn.mockResolvedValue(false)
  handler.handleRepeatingTaskCompletion.mockResolvedValue(rollForward)
})

describe('handing a GitHub board’s series to the spawn job (AWTD-1118)', () => {
  it('does not roll a GitHub-backed task forward', async () => {
    recurrence.enqueueRecurrenceSpawn.mockResolvedValue(true)
    expect(await resolveRepeatingTaskCompletion(completing)).toBeNull()
    expect(recurrence.enqueueRecurrenceSpawn).toHaveBeenCalledWith('task-1')
  })

  it('rolls a personal list forward exactly as before', async () => {
    recurrence.enqueueRecurrenceSpawn.mockResolvedValue(false)
    expect(await resolveRepeatingTaskCompletion(completing)).toEqual(rollForward)
  })

  it('never hands over a terminating series, which has no successor to make', async () => {
    handler.handleRepeatingTaskCompletion.mockResolvedValue(terminating)
    expect(await resolveRepeatingTaskCompletion(completing)).toEqual(terminating)
    expect(recurrence.enqueueRecurrenceSpawn).not.toHaveBeenCalled()
  })

  it('never reaches the handoff for a cancelled completion', async () => {
    expect(await resolveRepeatingTaskCompletion({ ...completing, closedReason: 'not_planned' })).toBeNull()
    expect(handler.handleRepeatingTaskCompletion).not.toHaveBeenCalled()
    expect(recurrence.enqueueRecurrenceSpawn).not.toHaveBeenCalled()
  })

  it('costs a deployment without GitHub Projects nothing', async () => {
    capabilities.hasCapability.mockReturnValue(false)
    expect(await resolveRepeatingTaskCompletion(completing)).toEqual(rollForward)
    expect(recurrence.enqueueRecurrenceSpawn).not.toHaveBeenCalled()
  })

  it('rolls forward when the handoff itself throws, rather than dropping the series', async () => {
    recurrence.enqueueRecurrenceSpawn.mockRejectedValue(new Error('queue unavailable'))
    expect(await resolveRepeatingTaskCompletion(completing)).toEqual(rollForward)
  })
})
