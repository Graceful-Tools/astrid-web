/**
 * Task 0672b69b — the dispatch itself, not just the helper.
 *
 * The vulnerability was in `lib/webhooks/task-assignment-notifier.ts`, where
 * `task.creatorId || task.lists?.[0]?.ownerId` chose which user's Claude Code
 * Remote server received the run. A list member who edits another user's task
 * and assigns an agent got the victim's machine and the victim's key.
 *
 * These tests drive the notifier with injected deps and assert on the user id
 * it actually dispatches to, and on the billing record it puts on the payload —
 * so a future refactor that re-derives the payer locally goes red here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))

// The agent runs in webhook mode, so dispatch reaches sendToUserWebhook rather
// than parking the task in a polling queue.
vi.mock('@/lib/ai/agent-execution-mode', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent-execution-mode')>()
  return { ...actual, isPollingOnlyAgent: vi.fn(async () => false) }
})

import { notifyTaskAssignment } from '@/lib/webhooks/task-assignment-notifier'

const AGENT = {
  id: 'agent-user',
  email: 'claude@astrid.cc',
  name: 'Claude Agent',
  isAIAgent: true,
  aiAgentType: 'claude',
  aiAgentConfig: null,
  webhookUrl: null,
}

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Task title',
    description: 'Task description',
    priority: 1,
    dueDateTime: null,
    creatorId: 'victim-user',
    assignee: AGENT,
    aiAgent: null,
    creator: { id: 'victim-user', name: 'Victim', email: 'victim@example.com' },
    lists: [
      {
        id: 'list-1',
        name: 'Shared list',
        description: null,
        githubRepositoryId: null,
        ownerId: 'list-owner',
        aiAgentConfiguredBy: 'configuring-user',
        owner: { id: 'list-owner', email: 'owner@example.com' },
      },
    ],
    comments: [],
    ...overrides,
  }
}

function buildDeps(task: Record<string, unknown>) {
  const sendToUserWebhook = vi.fn(async () => ({ sent: true, status: 200 }))
  const prisma = {
    task: { findFirst: vi.fn(async () => task) },
    mCPToken: {
      findFirst: vi.fn(async () => ({ id: 'tok-1', token: 'plain-token', tokenHash: null })),
      create: vi.fn(),
    },
    user: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    taskList: { findMany: vi.fn(async () => []) },
    listMember: { findMany: vi.fn(async () => []) },
  }
  const pushService = { sendToUser: vi.fn(), sendNotificationToUser: vi.fn() }
  return { deps: { prisma, pushService, sendToUserWebhook } as never, sendToUserWebhook }
}

describe('agent dispatch billing (task 0672b69b)', () => {
  beforeEach(() => vi.clearAllMocks())

  it("does not dispatch to the task creator's server when a list member triggers the run", async () => {
    const { deps, sendToUserWebhook } = buildDeps(buildTask())

    await notifyTaskAssignment({ taskId: 'task-1', aiAgentId: AGENT.id }, deps)

    expect(sendToUserWebhook).toHaveBeenCalled()
    expect(sendToUserWebhook.mock.calls[0][0]).not.toBe('victim-user')
    expect(sendToUserWebhook.mock.calls[0][0]).toBe('configuring-user')
  })

  it('records the paying user on the dispatch payload rather than leaving it to be re-derived', async () => {
    const { deps, sendToUserWebhook } = buildDeps(buildTask())

    await notifyTaskAssignment({ taskId: 'task-1', aiAgentId: AGENT.id }, deps)

    const payload = sendToUserWebhook.mock.calls[0][2] as {
      billing: { userId: string | null; source: string }
    }
    expect(payload.billing).toEqual({ userId: 'configuring-user', source: 'list-configured-by' })
  })

  it('bills the list owner, never the creator, when the list configured nobody', async () => {
    const task = buildTask()
    task.lists[0].aiAgentConfiguredBy = null
    const { deps, sendToUserWebhook } = buildDeps(task)

    await notifyTaskAssignment({ taskId: 'task-1', aiAgentId: AGENT.id }, deps)

    expect(sendToUserWebhook.mock.calls[0][0]).toBe('list-owner')
    const payload = sendToUserWebhook.mock.calls[0][2] as { billing: { source: string } }
    expect(payload.billing.source).toBe('list-owner')
  })
})
