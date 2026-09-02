import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    codingTaskWorkflow: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    comment: { create: vi.fn() },
  },
}))

const { executeCompleteWorkflow, createForTask } = vi.hoisted(() => {
  const execute = vi.fn().mockResolvedValue(undefined)
  return {
    executeCompleteWorkflow: execute,
    createForTask: vi
      .fn()
      .mockResolvedValue({ executeCompleteWorkflow: execute }),
  }
})
vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: { createForTask },
}))

import { POST } from '@/app/api/coding-agent/github-trigger/route'
import { authenticateAPI, requireTaskAccess } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const githubContext = {
  repository: 'Graceful-Tools/astrid-web',
  ref: 'refs/heads/main',
  sha: '1234567890abcdef',
  actor: 'github-actions',
  workflow: 'Fix All Ready Tasks',
  runId: '33584352851',
  runNumber: '1',
}

function request() {
  return new NextRequest('http://localhost/api/coding-agent/github-trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAuth-Token': 'astrid_access_token',
    },
    body: JSON.stringify({ taskId: TASK_ID, githubContext }),
  })
}

describe('POST /api/coding-agent/github-trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue({
      userId: 'owner-1',
      source: 'oauth',
      scopes: ['tasks:write'],
    } as never)
    vi.mocked(requireTaskAccess).mockResolvedValue(undefined)
    vi.mocked(prisma.codingTaskWorkflow.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.codingTaskWorkflow.create).mockResolvedValue({
      id: 'workflow-1',
      metadata: {},
    } as never)
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 'comment-1',
    } as never)
  })

  it('accepts OAuth and attributes run 33584352851 to the assigned Copilot agent', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: TASK_ID,
      title: 'Fix the local runner',
      creatorId: 'owner-1',
      creator: { id: 'owner-1', name: 'Owner' },
      assignee: {
        id: 'copilot-1',
        name: 'GitHub Copilot Agent',
        email: 'copilot@astrid.cc',
        isAIAgent: true,
        isActive: true,
      },
      lists: [],
    } as never)

    const response = await POST(request(), undefined as never)

    expect(response.status).toBe(200)
    expect(requireTaskAccess).toHaveBeenCalledWith('owner-1', TASK_ID)
    expect(prisma.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorId: 'copilot-1',
          taskId: TASK_ID,
        }),
      }),
    )
  })

  it('does not let an OAuth caller trigger a task assigned to another agent', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: TASK_ID,
      title: 'Other agent task',
      creatorId: 'owner-1',
      creator: { id: 'owner-1', name: 'Owner' },
      assignee: {
        id: 'claude-1',
        name: 'Claude Agent',
        email: 'claude@astrid.cc',
        isAIAgent: true,
        isActive: true,
      },
      lists: [],
    } as never)

    const response = await POST(request(), undefined as never)

    expect(response.status).toBe(403)
    expect(prisma.codingTaskWorkflow.create).not.toHaveBeenCalled()
    expect(prisma.comment.create).not.toHaveBeenCalled()
  })
})
