/**
 * RED for task 2b4330e0.
 *
 * POST /api/coding-workflow/start-ai-orchestration checked only that the caller
 * was SIGNED IN, then took `taskId` AND `userId` from the request body and ran
 * `AIOrchestrator.createForTask(taskId, userId)`. So any authenticated user
 * could start a full AI coding workflow against any task, executing as any
 * other user — their AI API keys, their GitHub integration, their repositories.
 *
 * Its sibling start-tools-workflow carries the identical fix and a comment
 * describing this exact bug (task 017a569a); this route was missed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

const getTaskForUser = vi.hoisted(() => vi.fn())
vi.mock('@/services/task.service', () => ({ getTaskForUser }))

const workflowFindUnique = vi.hoisted(() => vi.fn())
const workflowUpdate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    codingTaskWorkflow: { findUnique: workflowFindUnique, update: workflowUpdate },
  },
}))

const createForTask = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: {
    createForTask: (...args: unknown[]) => createForTask(...args),
  },
}))
vi.mock('@/lib/api-key-cache', () => ({ getPreferredAIService: vi.fn() }))

const CALLER = 'user-caller'
const VICTIM = 'user-victim'

function post(body: unknown) {
  return new NextRequest('http://localhost/api/coding-workflow/start-ai-orchestration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue({ user: { id: CALLER } })
  getTaskForUser.mockResolvedValue({ ok: true, task: { id: 't1' } })
  workflowFindUnique.mockResolvedValue({ id: 'wf1', taskId: 't1' })
  createForTask.mockResolvedValue({ executeCompleteWorkflow: vi.fn().mockResolvedValue(undefined) })
})

describe('start-ai-orchestration authorization (task 2b4330e0)', () => {
  it('401s an unauthenticated caller', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/coding-workflow/start-ai-orchestration/route')

    expect((await POST(post({ workflowId: 'wf1', taskId: 't1' }))).status).toBe(401)
  })

  it('403s a caller with no access to the task, without starting anything', async () => {
    getTaskForUser.mockResolvedValue({ ok: false, status: 403, error: 'Access denied' })
    const { POST } = await import('@/app/api/coding-workflow/start-ai-orchestration/route')

    const response = await POST(post({ workflowId: 'wf1', taskId: 'someone-elses-task' }))

    expect(response.status).toBe(403)
    expect(createForTask).not.toHaveBeenCalled()
  })

  it('never runs as a userId supplied in the body', async () => {
    const { POST } = await import('@/app/api/coding-workflow/start-ai-orchestration/route')

    await POST(post({ workflowId: 'wf1', taskId: 't1', userId: VICTIM }))

    expect(getTaskForUser).toHaveBeenCalledWith('t1', CALLER)
    expect(createForTask).toHaveBeenCalledWith('t1', CALLER)
  })

  it('refuses a workflow that belongs to a different task', async () => {
    workflowFindUnique.mockResolvedValue({ id: 'wf1', taskId: 'another-task' })
    const { POST } = await import('@/app/api/coding-workflow/start-ai-orchestration/route')

    const response = await POST(post({ workflowId: 'wf1', taskId: 't1' }))

    expect(response.status).toBe(404)
    expect(createForTask).not.toHaveBeenCalled()
  })

  it('still 400s on a missing field before authorising', async () => {
    const { POST } = await import('@/app/api/coding-workflow/start-ai-orchestration/route')

    expect((await POST(post({ workflowId: 'wf1' }))).status).toBe(400)
    expect(getTaskForUser).not.toHaveBeenCalled()
  })
})
