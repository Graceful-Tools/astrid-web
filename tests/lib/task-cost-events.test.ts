/**
 * Task 315949e1 — the task cost ledger, phase 0.
 *
 * The spec's bet is that a cost feature is only worth building if the actuals
 * arrive automatically and the sum is believable. So these tests are mostly
 * about refusing to write anything that would make the sum a lie: no NaN, no
 * floats, no double-counted retries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskCostEvent: { create: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
  },
}))

import { recordTaskCost, getTaskActualCostCents } from '@/lib/task-cost-events'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const mockPrisma = vi.mocked(prisma)

const valid = {
  taskId: 'task-1',
  provider: 'anthropic',
  model: 'claude-opus-5',
  inputTokens: 1000,
  outputTokens: 500,
  costCents: 42,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskCostEvent.create.mockResolvedValue({ id: 'evt-1', ...valid } as never)
})

describe('recordTaskCost (task 315949e1)', () => {
  it('writes a well-formed event', async () => {
    const result = await recordTaskCost(valid)

    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(mockPrisma.taskCostEvent.create).toHaveBeenCalled()
  })

  it('requires provider and model', async () => {
    expect(await recordTaskCost({ ...valid, provider: '' })).toMatchObject({ ok: false, status: 400 })
    expect(await recordTaskCost({ ...valid, model: undefined })).toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.taskCostEvent.create).not.toHaveBeenCalled()
  })

  it('rejects token counts that are not non-negative integers', async () => {
    // Coercing these would put NaN or nonsense in a table whose entire value is
    // that its sum is believable.
    for (const bad of [NaN, -1, 1.5, '1000', null, undefined]) {
      expect(await recordTaskCost({ ...valid, inputTokens: bad })).toMatchObject({ ok: false, status: 400 })
      expect(await recordTaskCost({ ...valid, outputTokens: bad })).toMatchObject({ ok: false, status: 400 })
    }
    expect(mockPrisma.taskCostEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a fractional costCents', async () => {
    // Money here is whole cents; a float would make sums drift.
    expect(await recordTaskCost({ ...valid, costCents: 4.2 })).toMatchObject({ ok: false, status: 400 })
  })

  it('ACCEPTS a negative costCents', async () => {
    // That is how a compensating event corrects a wrong price without mutating
    // history. The ledger is append-only.
    const result = await recordTaskCost({ ...valid, costCents: -42 })

    expect(result.ok).toBe(true)
  })

  it('accepts a zero-cost event', async () => {
    // A cached or free call still happened and is worth metering.
    expect((await recordTaskCost({ ...valid, costCents: 0, inputTokens: 0, outputTokens: 0 })).ok).toBe(true)
  })

  it('trims provider and model before storing', async () => {
    await recordTaskCost({ ...valid, provider: '  anthropic  ', model: '  claude-opus-5  ' })

    const data = (mockPrisma.taskCostEvent.create.mock.calls[0][0] as never as {
      data: { provider: string; model: string }
    }).data
    expect(data.provider).toBe('anthropic')
    expect(data.model).toBe('claude-opus-5')
  })

  describe('idempotency', () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    })

    it('returns the existing event when a report is retried', async () => {
      mockPrisma.taskCostEvent.create.mockRejectedValue(duplicateError)
      mockPrisma.taskCostEvent.findFirst.mockResolvedValue({ id: 'evt-first' } as never)

      const result = await recordTaskCost({ ...valid, externalId: 'run-123' })

      expect(result).toMatchObject({ ok: true, duplicate: true })
      expect(result.ok === true && result.event.id).toBe('evt-first')
    })

    it('looks the duplicate up scoped to the task, not globally', async () => {
      // Two different tasks may legitimately be reported under the same run id.
      mockPrisma.taskCostEvent.create.mockRejectedValue(duplicateError)
      mockPrisma.taskCostEvent.findFirst.mockResolvedValue({ id: 'evt-first' } as never)

      await recordTaskCost({ ...valid, externalId: 'run-123' })

      expect(mockPrisma.taskCostEvent.findFirst).toHaveBeenCalledWith({
        where: { taskId: 'task-1', externalId: 'run-123' },
      })
    })

    it('does not swallow a constraint error when no externalId was supplied', async () => {
      // A reporter that sends no idempotency key has not asked for one, so a
      // P2002 here means something else went wrong and must surface.
      mockPrisma.taskCostEvent.create.mockRejectedValue(duplicateError)

      await expect(recordTaskCost(valid)).rejects.toThrow()
    })

    it('does not swallow other Prisma errors', async () => {
      mockPrisma.taskCostEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('nope', { code: 'P2003', clientVersion: 'test' })
      )

      await expect(recordTaskCost({ ...valid, externalId: 'run-123' })).rejects.toThrow()
    })
  })
})

describe('getTaskActualCostCents (task 315949e1)', () => {
  it('sums the ledger', async () => {
    mockPrisma.taskCostEvent.aggregate.mockResolvedValue({ _sum: { costCents: 137 } } as never)

    expect(await getTaskActualCostCents('task-1')).toBe(137)
  })

  it('reports zero for a task with no events', async () => {
    mockPrisma.taskCostEvent.aggregate.mockResolvedValue({ _sum: { costCents: null } } as never)

    expect(await getTaskActualCostCents('task-1')).toBe(0)
  })
})
