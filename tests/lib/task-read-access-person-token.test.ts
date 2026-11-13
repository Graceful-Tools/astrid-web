/**
 * AWTD-1642: the queue reconciles a custom agent's Ready work by reading each task
 * through GET /api/v1/tasks/:id. That read must not depend on the caller being an
 * AI-agent user — a person-owned token reaches a task the person created, is
 * assigned to, or owns/belongs to a list of, and nothing else.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { requireTaskReadAccess, taskReadAccessWhere } from '@/lib/api-auth-middleware'

describe('AWTD-1642 task-detail read access for a person-owned token', () => {
  beforeEach(() => {
    mockPrisma.task.findFirst.mockReset()
  })

  it('is decided by membership alone — no AI-agent flag anywhere in the rule', () => {
    const where = JSON.stringify(taskReadAccessWhere('person-1'))
    expect(where).not.toContain('isAIAgent')
    expect(where).toContain('"ownerId":"person-1"')
    expect(where).toContain('"assigneeId":"person-1"')
  })

  it('admits a person who can see the task and refuses one who cannot', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({ id: 't1' })
    await expect(requireTaskReadAccess('person-1', 't1')).resolves.toBeUndefined()

    mockPrisma.task.findFirst.mockResolvedValueOnce(null)
    await expect(requireTaskReadAccess('stranger', 't1')).rejects.toThrow('Access denied')
  })
})
