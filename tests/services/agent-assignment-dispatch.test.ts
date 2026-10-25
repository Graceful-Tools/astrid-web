/**
 * P1 step 3 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md — one implementation
 * of "an AI agent was assigned a task".
 *
 * There were two. Task create called the notifier
 * (lib/webhooks/task-assignment-notifier.ts, via aiAgentWebhookService). Task
 * update relied on a `$extends` hook in lib/prisma.ts that fired on ANY raw
 * `prisma.task.update({ assigneeId })` and only for "coding" agent types — so
 * assigning the default assistant to an existing task notified nobody, polling
 * mode was ignored on that path, and any raw assignee write anywhere started a
 * billable run (the AWTD-1089 attack). Both paths now call this.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma } from '../setup'

const { notifyTaskAssignment, notifyTaskAssignmentViaAIAgentId, runAfterResponse } = vi.hoisted(() => ({
  notifyTaskAssignment: vi.fn(),
  notifyTaskAssignmentViaAIAgentId: vi.fn(),
  runAfterResponse: vi.fn((_label: string, work: () => Promise<unknown>) => { void work() }),
}))
vi.mock('@/lib/ai-agent-webhook-service', () => ({
  aiAgentWebhookService: { notifyTaskAssignment, notifyTaskAssignmentViaAIAgentId },
}))
vi.mock('@/lib/background', () => ({ runAfterResponse }))

import { dispatchAgentAssignment } from '@/services/agent-assignment-dispatch'

describe('dispatchAgentAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies an AI assignee exactly once', async () => {
    await dispatchAgentAssignment({ taskId: 't1', assigneeId: 'agent-1', assignee: { isAIAgent: true } })

    expect(notifyTaskAssignment).toHaveBeenCalledTimes(1)
    expect(notifyTaskAssignment).toHaveBeenCalledWith('t1', 'agent-1')
  })

  it('notifies the default assistant too — not only "coding" agent types', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isAIAgent: true, aiAgentType: 'astrid' })

    await dispatchAgentAssignment({ taskId: 't1', assigneeId: 'astrid-agent' })

    expect(notifyTaskAssignment).toHaveBeenCalledWith('t1', 'astrid-agent')
  })

  it('does nothing for a human assignee', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isAIAgent: false })

    await dispatchAgentAssignment({ taskId: 't1', assigneeId: 'person-1' })

    expect(notifyTaskAssignment).not.toHaveBeenCalled()
  })

  it('does nothing when the assignee did not change', async () => {
    await dispatchAgentAssignment({
      taskId: 't1', assigneeId: 'agent-1', previousAssigneeId: 'agent-1', assignee: { isAIAgent: true },
    })

    expect(notifyTaskAssignment).not.toHaveBeenCalled()
  })

  it('falls back to the legacy aiAgentId when there is no assignee', async () => {
    await dispatchAgentAssignment({ taskId: 't1', assigneeId: null, aiAgentId: 'legacy-agent' })

    expect(notifyTaskAssignmentViaAIAgentId).toHaveBeenCalledWith('t1', 'legacy-agent')
  })

  it('can defer the run past the response, as an update must', async () => {
    await dispatchAgentAssignment({
      taskId: 't1', assigneeId: 'agent-1', assignee: { isAIAgent: true }, deferred: true,
    })

    expect(runAfterResponse).toHaveBeenCalledWith('task-assignee-change', expect.any(Function))
    expect(notifyTaskAssignment).toHaveBeenCalledTimes(1)
  })

  it('never throws — a failed notification must not fail the write', async () => {
    notifyTaskAssignment.mockRejectedValue(new Error('webhook down'))

    await expect(
      dispatchAgentAssignment({ taskId: 't1', assigneeId: 'agent-1', assignee: { isAIAgent: true } }),
    ).resolves.toBeUndefined()
  })
})
