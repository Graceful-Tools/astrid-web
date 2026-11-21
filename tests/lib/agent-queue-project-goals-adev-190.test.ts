/**
 * ADEV-190: the agent queue's projectGoals entries are keyed by list, like listInstructions, so a
 * client that matches guidance by its task's list (the SDK runner) finds them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { taskList: { findMany: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { collectProjectGoals } from '@/lib/agent-queue-project-goals'
import { buildPrompt } from '../../packages/astrid-sdk/src/run'

const FUND = {
  goals: [{ id: 'returns', statement: 'Maximise long-term returns' }],
  guardrails: [{ id: 'law', statement: 'Break no applicable laws', kind: 'stated' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.taskList.findMany).mockResolvedValue([
    { id: 'l1', project: { id: 'p1', name: 'Fund', goalsAndGuardrails: FUND } },
    { id: 'l2', project: { id: 'p1', name: 'Fund', goalsAndGuardrails: FUND } },
    { id: 'l3', project: { id: 'p2', name: 'Quiet', goalsAndGuardrails: null } },
  ] as never)
})

describe('queue projectGoals keyed by list (ADEV-190)', () => {
  it('has one entry per queued task list whose project states goals, each naming its list', async () => {
    const entries = await collectProjectGoals([
      { lists: [{ id: 'l1' }] },
      { lists: [{ id: 'l2' }] },
      { lists: [{ id: 'l1' }] },
      { lists: [{ id: 'l3' }] },
    ])
    expect(entries.map(e => [e.listId, e.projectId])).toEqual([
      ['l1', 'p1'],
      ['l2', 'p1'],
    ])
    expect(entries[0]).toMatchObject({ projectName: 'Fund', goals: FUND.goals, guardrails: FUND.guardrails })
    expect(entries[0].instructions).toContain('<untrusted_project_goals')
  })

  it('the SDK runner puts a task\'s project goals in its prompt from the real queue entry', async () => {
    const projectGoals = await collectProjectGoals([{ lists: [{ id: 'l2' }] }])
    const prompt = buildPrompt({ id: 't1', title: 'Rebalance', listId: 'l2' } as never, 'claude', { projectGoals })
    expect(prompt).toContain('Maximise long-term returns')
  })

  it('is empty without tasks, and when the read fails', async () => {
    expect(await collectProjectGoals([])).toEqual([])
    vi.mocked(prisma.taskList.findMany).mockRejectedValue(new Error('db down'))
    expect(await collectProjectGoals([{ lists: [{ id: 'l1' }] }])).toEqual([])
  })
})
