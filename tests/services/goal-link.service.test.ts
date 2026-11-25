/**
 * ADEV-271 — tasks and lists link to their project's goals: a task's goals are its own links plus its
 * lists' links, a `GOAL:` report line writes a `report` link, and a list link needs list admin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    taskList: { findUnique: vi.fn() },
    goalLink: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn((args: unknown) => args) },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}))

import { prisma } from '@/lib/prisma'
import {
  getListGoalLinks,
  getTaskGoals,
  linkGoalsFromReport,
  parseGoalIds,
  setListGoalLinks,
  setTaskGoals,
} from '@/services/goal-link.service'

const GOALS = {
  goals: [
    { id: 'g1', statement: 'Ship faster' },
    { id: 'g2', statement: 'Fewer bugs' },
  ],
  guardrails: [],
}
const PROJECT = { id: 'p1', name: 'Fund', goalsAndGuardrails: GOALS }
const TASK = { id: 't1', lists: [{ id: 'l1', projectId: 'p1', project: PROJECT }] }

function list(role: 'admin' | 'member') {
  return {
    id: 'l1', ownerId: 'owner', privacy: 'PRIVATE', publicListType: null, listType: 'regular', isVirtual: false,
    projectId: 'p1', project: PROJECT,
    listMembers: [{ userId: 'u1', role }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.task.findUnique).mockResolvedValue(TASK as never)
  vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list('admin') as never)
  vi.mocked(prisma.goalLink.findMany).mockResolvedValue([])
})

describe('parseGoalIds (ADEV-271)', () => {
  it('takes goalIds or one goalId, deduplicated, and refuses anything else', () => {
    expect(parseGoalIds({ goalIds: ['g1', 'g1', ' g2 '] })).toEqual({ goalIds: ['g1', 'g2'], projectId: undefined })
    expect(parseGoalIds({ goalId: 'g1', projectId: 'p1' })).toEqual({ goalIds: ['g1'], projectId: 'p1' })
    expect(parseGoalIds({ goalIds: [1] })).toBeNull()
    expect(parseGoalIds(undefined)).toBeNull()
  })
})

describe('getTaskGoals (ADEV-271)', () => {
  it("is the task's own links plus its lists' links, and ignores a goal the project no longer states", async () => {
    vi.mocked(prisma.goalLink.findMany).mockResolvedValue([
      { projectId: 'p1', goalId: 'g1', taskId: 't1', listId: null, source: 'person' },
      { projectId: 'p1', goalId: 'g2', taskId: null, listId: 'l1', source: 'agent' },
      { projectId: 'p1', goalId: 'gone', taskId: 't1', listId: null, source: 'report' },
    ] as never)
    const result = await getTaskGoals('t1')
    expect(result).toEqual({
      ok: true,
      value: {
        taskId: 't1',
        links: [
          { projectId: 'p1', projectName: 'Fund', goalId: 'g1', statement: 'Ship faster', via: 'task', source: 'person' },
          { projectId: 'p1', projectName: 'Fund', goalId: 'g2', statement: 'Fewer bugs', via: 'list', listId: 'l1', source: 'agent' },
        ],
      },
    })
  })
})

describe('setTaskGoals (ADEV-271)', () => {
  it('replaces the own links in the only project, recording who made them', async () => {
    await setTaskGoals('t1', 'u1', { goalIds: ['g1'] }, 'agent')
    expect(prisma.goalLink.deleteMany).toHaveBeenCalledWith({ where: { taskId: 't1', projectId: 'p1', goalId: { notIn: ['g1'] } } })
    expect(prisma.goalLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { taskId: 't1', projectId: 'p1', goalId: 'g1', source: 'agent', createdById: 'u1' }, update: {} }),
    )
  })

  it('refuses a goal the project does not state', async () => {
    const result = await setTaskGoals('t1', 'u1', { goalIds: ['nope'] }, 'person')
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('asks for projectId when the task spans several projects', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      id: 't1',
      lists: [TASK.lists[0], { id: 'l2', projectId: 'p2', project: { ...PROJECT, id: 'p2' } }],
    } as never)
    expect(await setTaskGoals('t1', 'u1', { goalIds: ['g1'] }, 'person')).toMatchObject({ ok: false, status: 400 })
    expect(await setTaskGoals('t1', 'u1', { goalIds: ['g1'], projectId: 'p2' }, 'person')).toMatchObject({ ok: true })
  })
})

describe('setListGoalLinks (ADEV-271)', () => {
  it('needs list admin', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list('member') as never)
    expect(await setListGoalLinks('l1', 'u1', { goalIds: ['g1'] }, 'person')).toMatchObject({ ok: false, status: 403 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lets an admin link, and a stranger sees a 404', async () => {
    expect(await setListGoalLinks('l1', 'u1', { goalIds: ['g1'] }, 'person')).toMatchObject({ ok: true })
    expect(prisma.goalLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { listId: 'l1', projectId: 'p1', goalId: 'g1', source: 'person', createdById: 'u1' } }),
    )
    expect(await getListGoalLinks('l1', 'stranger')).toMatchObject({ ok: false, status: 404 })
  })
})

describe('linkGoalsFromReport (ADEV-271)', () => {
  it('links the goals a GOAL: line names with source report, skipping unknown ids', async () => {
    const linked = await linkGoalsFromReport('t1', 'Done.\nGOAL: g1, nope', 'agent-1')
    expect(linked).toBe(1)
    expect(prisma.goalLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { taskId: 't1', projectId: 'p1', goalId: 'g1', source: 'report', createdById: 'agent-1' }, update: {} }),
    )
  })

  it('does nothing for a comment with no GOAL: line', async () => {
    expect(await linkGoalsFromReport('t1', 'just a comment', 'u1')).toBe(0)
    expect(prisma.task.findUnique).not.toHaveBeenCalled()
  })
})
