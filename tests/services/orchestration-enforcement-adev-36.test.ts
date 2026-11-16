// @vitest-environment node
/**
 * ADEV-36 — the server enforces the orchestration policy where agents act: at claim, at queue
 * routing of unassigned Ready tasks, and in what get_agent_queue returns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findFirst: vi.fn(), findUnique: vi.fn(), updateManyAndReturn: vi.fn() },
    taskList: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { claimAgentTask } from '@/services/agent-task-claim.service'
import { agentMayTakeUnassigned, listPolicyForAgent } from '@/services/orchestration-policy.service'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const readyTask = {
  id: TASK_ID,
  statusRole: 'ready',
  completed: false,
  assigneeId: null,
  assigneeIds: [],
  updatedAt: new Date('2026-11-08T10:00:00.000Z'),
}
const claimedTask = { ...readyTask, statusRole: 'doing', assigneeId: 'agent-claude', assigneeIds: ['agent-claude'] }

const routedTo = (mailbox: string) => ({
  id: 'list-1',
  projectId: null,
  orchestrationPolicy: { routing: { assignTo: mailbox } },
  project: null,
})

describe('ADEV-36 policy enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.task.findFirst).mockResolvedValue(readyTask as never)
    vi.mocked(prisma.task.findUnique).mockResolvedValue({ lists: [{ id: 'list-1' }] } as never)
    vi.mocked(prisma.task.updateManyAndReturn).mockResolvedValue([claimedTask] as never)
  })

  it('ADEV-36: nothing stored lets any agent take an unassigned Ready task', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({ ...routedTo('x'), orchestrationPolicy: null } as never)
    expect(await agentMayTakeUnassigned('list-1', 'claude')).toEqual({ take: true, reason: 'anyAdmittedAgent' })
  })

  it('ADEV-36: a list routed to codex refuses claude, with a reason', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(routedTo('codex') as never)
    expect(await agentMayTakeUnassigned('list-1', 'claude')).toEqual({ take: false, reason: 'routedElsewhere' })
    expect(await agentMayTakeUnassigned('list-1', 'codex')).toMatchObject({ take: true })
  })

  it('ADEV-36: claiming an unassigned task routed to another agent is forbidden and writes nothing', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(routedTo('codex') as never)
    const result = await claimAgentTask({
      taskId: TASK_ID,
      userId: 'owner-1',
      agentId: 'agent-claude',
      agentMailbox: 'claude',
      action: 'claim',
    })
    expect(result.outcome).toBe('forbidden')
    expect(result.policy?.reason).toBe('routedElsewhere')
    expect(prisma.task.updateManyAndReturn).not.toHaveBeenCalled()
  })

  it('ADEV-36: the routed agent still claims it', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(routedTo('claude') as never)
    const result = await claimAgentTask({
      taskId: TASK_ID,
      userId: 'owner-1',
      agentId: 'agent-claude',
      agentMailbox: 'claude',
      action: 'claim',
    })
    expect(result.outcome).toBe('claimed')
  })

  it('ADEV-36: a task already assigned to the agent is claimable whatever the routing says', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(routedTo('codex') as never)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ ...readyTask, assigneeId: 'agent-claude', assigneeIds: ['agent-claude'] } as never)
    const result = await claimAgentTask({
      taskId: TASK_ID,
      userId: 'owner-1',
      agentId: 'agent-claude',
      agentMailbox: 'claude',
      action: 'claim',
    })
    expect(result.outcome).toBe('claimed')
  })

  it('ADEV-36: get_agent_queue reports the effective policy for the list, as this agent sees it', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...routedTo('codex'),
      orchestrationPolicy: { routing: { assignTo: 'codex' }, autonomy: { merge: 'allowed' }, escalation: { to: 'taskCreator' } },
    } as never)
    const view = await listPolicyForAgent('list-1', 'claude')
    expect(view).toMatchObject({
      listId: 'list-1',
      route: { take: false, reason: 'routedElsewhere' },
      effective: { routing: { assignTo: 'codex' }, autonomy: { merge: 'allowed' }, escalation: { to: 'taskCreator' } },
      may: { merge: { decision: 'allowed', reason: 'policy' } },
    })
  })
})
