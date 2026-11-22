/**
 * ADEV-179 — a project's goals and guardrails over v1: stated per project, readable by everyone
 * working in it (agents included), editable only by its owner or an admin, never by an agent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), findMany: vi.fn() },
    project: { findUnique: vi.fn(), update: vi.fn() },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { GET as getProject, PUT as putProject } from '@/app/api/v1/projects/[id]/goals/route'
import { GET as getList } from '@/app/api/v1/lists/[id]/goals/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { goalsForLists } from '@/services/project-goals.service'
import { Prisma } from '@prisma/client'

const PROJECT_ID = 'project-1'
const LIST_ID = 'list-1'
const STATED = {
  goals: [{ id: 'returns', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr' }],
  guardrails: [{ id: 'law', statement: 'Break no applicable laws', kind: 'stated' }],
}

function person(id: string, isAIAgent = false) {
  return {
    userId: id, source: 'session', scopes: ['*'], isAIAgent,
    user: { id, email: `${id}@example.test`, name: id, isAIAgent }, agentUser: null,
  }
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID, name: 'Fund', ownerId: 'owner', goalsAndGuardrails: STATED,
    members: [{ userId: 'padmin', role: 'ADMIN' }, { userId: 'pmember', role: 'member' }],
    lists: [{ id: LIST_ID, ownerId: 'owner', listMembers: [{ userId: 'plain' }, { userId: 'claude-agent' }] }],
    ...overrides,
  }
}

function list(overrides: Record<string, unknown> = {}) {
  return {
    id: LIST_ID, ownerId: 'owner', privacy: 'PRIVATE', publicListType: null, listType: 'regular', isVirtual: false,
    projectId: PROJECT_ID,
    listMembers: [{ userId: 'plain', role: 'member' }, { userId: 'claude-agent', role: 'member' }],
    project: { id: PROJECT_ID, name: 'Fund', ownerId: 'owner', members: [], lists: [], goalsAndGuardrails: STATED },
    ...overrides,
  }
}

const projectParams = { params: Promise.resolve({ id: PROJECT_ID }) }
const listParams = { params: Promise.resolve({ id: LIST_ID }) }
const req = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, body === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireScopes).mockReturnValue(undefined)
  vi.mocked(prisma.project.findUnique).mockResolvedValue(project() as never)
  vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list() as never)
})

describe('GET /api/v1/projects/:id/goals (ADEV-179)', () => {
  it('answers the stated goals and guardrails to the owner, who can edit them', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await getProject(req(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      projectId: PROJECT_ID, projectName: 'Fund', ...STATED, workByGoal: {}, canEdit:true,
      meta: { apiVersion: 'v1', authSource: 'session' },
    })
  })

  it('people and agents on the project\'s lists read them but cannot edit', async () => {
    for (const caller of [person('plain'), person('claude-agent', true), person('pmember')]) {
      vi.mocked(authenticateAPI).mockResolvedValue(caller as never)
      const body = await (await getProject(req(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).json()
      expect(body.goals).toEqual(STATED.goals)
      expect(body.canEdit).toBe(false)
    }
  })

  it('nothing stored answers empty lists', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ goalsAndGuardrails: null }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const body = await (await getProject(req(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).json()
    expect(body).toMatchObject({ goals: [], guardrails: [] })
  })

  it('is 404 for someone outside the project, and for a project that does not exist', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getProject(req(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).status).toBe(404)
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    expect((await getProject(req(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).status).toBe(404)
  })
})

describe('PUT /api/v1/projects/:id/goals (ADEV-179)', () => {
  it('the owner replaces them, normalised, and gets the stored value back', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await putProject(
      req(`/api/v1/projects/${PROJECT_ID}/goals`, { goals: [{ statement: ' Ship weekly ' }], guardrails: [{ statement: 'Keep data private' }] }),
      projectParams,
    )
    expect(response.status).toBe(200)
    const stored = { goals: [{ id: 'g1', statement: 'Ship weekly' }], guardrails: [{ id: 'r1', statement: 'Keep data private', kind: 'stated' }] }
    expect(await response.json()).toMatchObject({ ...stored, canEdit: true })
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: PROJECT_ID }, data: { goalsAndGuardrails: stored } })
  })

  it('a project admin may edit them', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('padmin') as never)
    expect((await putProject(req(`/api/v1/projects/${PROJECT_ID}/goals`, STATED), projectParams)).status).toBe(200)
  })

  it('null, or both lists empty, clears the column to SQL NULL', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    for (const body of [null, { goals: [], guardrails: [] }]) {
      vi.mocked(prisma.project.update).mockClear()
      expect((await putProject(req(`/api/v1/projects/${PROJECT_ID}/goals`, body), projectParams)).status).toBe(200)
      expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: PROJECT_ID }, data: { goalsAndGuardrails: Prisma.DbNull } })
    }
  })

  it('an agent is refused, even one that works in the project', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('claude-agent', true) as never)
    const response = await putProject(req(`/api/v1/projects/${PROJECT_ID}/goals`, STATED), projectParams)
    expect(response.status).toBe(403)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('a member who is not an admin is refused', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('pmember') as never)
    expect((await putProject(req(`/api/v1/projects/${PROJECT_ID}/goals`, STATED), projectParams)).status).toBe(403)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('a value the rules refuse is a 400', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await putProject(req(`/api/v1/projects/${PROJECT_ID}/goals`, { guardrails: [{ statement: 'x', kind: 'soft' }] }), projectParams)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/stated" or "enforced/)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/lists/:id/goals (ADEV-179)', () => {
  it('answers the goals of the list\'s project to an agent on the list', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('claude-agent', true) as never)
    const response = await getList(req(`/api/v1/lists/${LIST_ID}/goals`), listParams)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ listId: LIST_ID, projectId: PROJECT_ID, projectName: 'Fund', ...STATED, canEdit: false })
  })

  it('a list in no project answers nothing stated', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ projectId: null, project: null }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const body = await (await getList(req(`/api/v1/lists/${LIST_ID}/goals`), listParams)).json()
    expect(body).toMatchObject({ projectId: null, projectName: null, goals: [], guardrails: [], canEdit: false })
  })

  it('is 404 for someone with no role on the list', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getList(req(`/api/v1/lists/${LIST_ID}/goals`), listParams)).status).toBe(404)
  })
})

describe('goalsForLists (ADEV-179)', () => {
  it('one entry per project with something stated, in the order first seen', async () => {
    vi.mocked(prisma.taskList.findMany).mockResolvedValue([
      { id: 'a', project: { id: 'p1', name: 'One', goalsAndGuardrails: STATED } },
      { id: 'b', project: { id: 'p1', name: 'One', goalsAndGuardrails: STATED } },
      { id: 'c', project: { id: 'p2', name: 'Two', goalsAndGuardrails: null } },
    ] as never)
    expect(await goalsForLists(['a', 'b', 'c'])).toEqual([{ projectId: 'p1', projectName: 'One', value: STATED, listIds: ['a', 'b'] }])
  })

  it('asks nothing for no lists', async () => {
    expect(await goalsForLists([])).toEqual([])
    expect(prisma.taskList.findMany).not.toHaveBeenCalled()
  })
})
