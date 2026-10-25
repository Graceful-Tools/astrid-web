/**
 * Regression for AWTD-1089 (task 09515763): `POST /api/invitations` with
 * `type: TASK_ASSIGNMENT` and an email that already belongs to a user assigned
 * the task with a raw `prisma.task.update({ assigneeId })`.
 *
 * That skipped `authorizeAssigneeChange` — the people rule and the AI-agent
 * rule AWTD-891 put in the service — so any list member could hand a task to
 * any account by email, AI agents included. The raw write also tripped the
 * `$extends` hook in lib/prisma.ts and started an agent run billed to the
 * list's configured user.
 *
 * The route must assign through `updateTaskWithSideEffects`, and its refusal
 * must reach the caller.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'

const { updateTaskWithSideEffects } = vi.hoisted(() => ({ updateTaskWithSideEffects: vi.fn() }))
vi.mock('@/services/task.service', () => ({ updateTaskWithSideEffects }))

vi.mock('@/lib/rate-limiter', () => ({
  inviteRateLimiter: { checkRateLimitByKeyAsync: vi.fn().mockResolvedValue({ allowed: true, resetTime: 0 }) },
}))

import { POST } from '@/app/api/invitations/route'

const AGENT = { id: 'agent-user', name: 'Claude', email: 'agent@agents.example' }

function invite(body: unknown) {
  return { json: async () => body, headers: { get: () => null }, url: 'http://localhost/api/invitations' } as any
}

describe('task-assignment invitations go through the assignee rule (AWTD-1089)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { id: 'member-1', name: 'Member', email: 'member@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    })
    mockPrisma.user.findUnique.mockResolvedValue(AGENT)
    mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-1' })
  })

  it('assigns through updateTaskWithSideEffects, never a raw task write', async () => {
    updateTaskWithSideEffects.mockResolvedValue({ ok: true, task: { id: 'task-1' }, rolledForward: false })

    const res = await POST(invite({ email: AGENT.email, type: 'TASK_ASSIGNMENT', taskId: 'task-1' }))

    expect(res.status).toBe(200)
    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', actorId: 'member-1', intent: { assigneeId: AGENT.id } }),
    )
    expect(mockPrisma.task.update).not.toHaveBeenCalled()
  })

  it("returns the service's refusal instead of assigning", async () => {
    updateTaskWithSideEffects.mockResolvedValue({
      ok: false, status: 403, error: 'You cannot assign this task to that agent',
    })

    const res = await POST(invite({ email: AGENT.email, type: 'TASK_ASSIGNMENT', taskId: 'task-1' }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You cannot assign this task to that agent')
    expect(mockPrisma.task.update).not.toHaveBeenCalled()
  })
})
