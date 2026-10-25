/**
 * AWTD-1106: the coding-workflow merge and change-request routes posted their
 * comments with `fetch(`${getBaseUrl()}/api/v1/tasks/:id/comments`)` and no
 * credentials. The v1 API refused every one, so the user never saw "Merge
 * Failed", "Implementation Complete", "Change Request Received" or "Error
 * Processing Changes". They now go through postCommentAs, as the task's
 * assignee (the agent speaking), or as the user when nobody is assigned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: vi.fn(() => null) }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { codingTaskWorkflow: { findUnique: vi.fn(), update: vi.fn() } },
}))
const mergePullRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/github-client', () => ({
  GitHubClient: { forUser: vi.fn(async () => ({ mergePullRequest })) },
}))
vi.mock('@/services/complete-task', () => ({ completeTask: vi.fn(async () => ({ ok: true })) }))
const handleChangeRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: { createForTask: vi.fn(async () => ({ handleChangeRequest })) },
}))
vi.mock('@/lib/api-key-cache', () => ({ getPreferredAIService: vi.fn() }))
const postCommentAs = vi.hoisted(() => vi.fn(async () => ({ ok: true, comment: { id: 'c1' } })))
vi.mock('@/services/post-comment-as', () => ({ postCommentAs }))

import { POST as merge } from '@/app/api/coding-workflow/merge-request/route'
import { POST as requestChanges } from '@/app/api/coding-workflow/request-changes/route'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)
const fetchSpy = vi.fn()

function req(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) })
}

function workflow(status: string, assigneeId: string | null = 'ai-agent-claude') {
  return {
    id: 'wf-1', taskId: 'task-1', status, metadata: {},
    repositoryId: 'org/repo', pullRequestNumber: 7,
    task: { id: 'task-1', creatorId: 'u1', assigneeId, creator: { id: 'u1' } },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchSpy)
  vi.mocked(getUnifiedSession).mockResolvedValue({ user: { id: 'u1', name: 'U' } } as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('AWTD-1106 coding-workflow comments go through the comment service', () => {
  it('merge success posts "Implementation Complete" as the assigned agent', async () => {
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(workflow('TESTING'))
    mergePullRequest.mockResolvedValue(undefined)

    const res = await merge(req('/api/coding-workflow/merge-request', { workflowId: 'wf-1', commentId: 'c0', taskId: 'task-1' }))

    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(postCommentAs).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', authorId: 'ai-agent-claude', content: expect.stringContaining('Implementation Complete'),
    }))
  })

  it('merge failure posts "Merge Failed", as the user when nobody is assigned', async () => {
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(workflow('TESTING', null))
    mergePullRequest.mockRejectedValue(new Error('conflict'))

    const res = await merge(req('/api/coding-workflow/merge-request', { workflowId: 'wf-1', commentId: 'c0', taskId: 'task-1' }))

    expect(res.status).toBe(500)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(postCommentAs).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', authorId: 'u1', content: expect.stringContaining('Merge Failed'),
    }))
  })

  it('request-changes posts the acknowledgement and the failure through the service', async () => {
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(workflow('TESTING'))
    handleChangeRequest.mockRejectedValue(new Error('boom'))

    const res = await requestChanges(req('/api/coding-workflow/request-changes', {
      workflowId: 'wf-1', commentId: 'c0', taskId: 'task-1', feedback: 'make it blue',
    }))
    await vi.waitFor(() => expect(postCommentAs).toHaveBeenCalledTimes(2))

    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(postCommentAs).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'ai-agent-claude', content: expect.stringContaining('Change Request Received'),
    }))
    expect(postCommentAs).toHaveBeenCalledWith(expect.objectContaining({
      authorId: 'ai-agent-claude', content: expect.stringContaining('Error Processing Changes'),
    }))
  })
})
