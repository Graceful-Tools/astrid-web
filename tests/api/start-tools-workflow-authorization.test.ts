/**
 * RED for a hole found while building service-layer slice 1 (task 017a569a).
 *
 * POST /api/coding-workflow/start-tools-workflow checked that the caller was
 * SIGNED IN and then never checked whether the task was theirs. Any
 * authenticated user could POST someone else's taskId and start an AI coding
 * workflow against it — which reads the task and its comments, and bills the
 * work to the list owner, since the route resolves `configuredByUserId` from
 * the list's `aiAgentConfiguredBy` rather than from the caller.
 *
 * Its sibling app/api/coding-workflow/create did have the check. The two
 * routes were written from the same shape and one of them simply lost it,
 * which is the argument for the rule living in one place.
 *
 * Separately filed, not fixed here: the only in-repo caller
 * (lib/webhooks/comment-notifier.ts) fetches this endpoint server-to-server
 * with NO cookie header, so getUnifiedSession() finds nothing and the call has
 * been 401ing into a swallowed catch. Adding authorization does not regress
 * that path, because that path was never reaching the handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

const getTaskForUser = vi.hoisted(() => vi.fn())
vi.mock('@/services/task.service', () => ({ getTaskForUser }))

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { task: { findUnique } } }))

vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: class {
    executeCompleteWorkflow = vi.fn().mockResolvedValue({ ok: true })
  },
}))
vi.mock('@/lib/ai/agent-config', () => ({ getAgentConfig: () => ({ service: 'claude' }) }))

const CALLER = 'user-caller'

function post(body: unknown) {
  return new NextRequest('http://localhost/api/coding-workflow/start-tools-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue({ user: { id: CALLER } })
})

describe('start-tools-workflow authorization (task 017a569a)', () => {
  it('401s an unauthenticated caller', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/coding-workflow/start-tools-workflow/route')

    expect((await POST(post({ taskId: 't1', repository: 'r' }))).status).toBe(401)
  })

  it('403s an authenticated caller who has no access to the task', async () => {
    getTaskForUser.mockResolvedValue({ ok: false, status: 403, error: 'Access denied' })
    const { POST } = await import('@/app/api/coding-workflow/start-tools-workflow/route')

    const response = await POST(post({ taskId: 'someone-elses-task', repository: 'r' }))

    expect(response.status).toBe(403)
    // The workflow must not be started, and the task must not be read for its
    // agent config — being told "not an AI task" would still leak that it
    // exists.
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('404s a task that does not exist, without distinguishing it from forbidden work', async () => {
    getTaskForUser.mockResolvedValue({ ok: false, status: 404, error: 'Task not found' })
    const { POST } = await import('@/app/api/coding-workflow/start-tools-workflow/route')

    expect((await POST(post({ taskId: 'nope', repository: 'r' }))).status).toBe(404)
  })

  it('authorises before doing anything else with the task', async () => {
    getTaskForUser.mockResolvedValue({ ok: false, status: 403, error: 'Access denied' })
    const { POST } = await import('@/app/api/coding-workflow/start-tools-workflow/route')

    await POST(post({ taskId: 't1', repository: 'r' }))

    expect(getTaskForUser).toHaveBeenCalledWith('t1', CALLER)
  })

  it('still 400s on a missing field before authorising', async () => {
    const { POST } = await import('@/app/api/coding-workflow/start-tools-workflow/route')

    expect((await POST(post({ taskId: 't1' }))).status).toBe(400)
    expect(getTaskForUser).not.toHaveBeenCalled()
  })
})
