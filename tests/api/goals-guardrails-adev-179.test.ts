/**
 * ADEV-179 — goals and guardrails over v1: stored on the project, readable by anyone on the
 * project or its lists, editable only by an owner or admin (never an agent).
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
  },
}))

import { GET as getList } from '@/app/api/v1/lists/[id]/goals/route'
import { GET as getProject, PUT as putProject } from '@/app/api/v1/projects/[id]/goals/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

const LIST_ID = 'list-1'
const PROJECT_ID = 'project-1'
const goals = {
  goals: [{ id: 'g1', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr' }],
  guardrails: [{ id: 'r1', statement: 'Break no applicable laws', kind: 'stated' }],
}

function person(id: string, isAIAgent = false) {
  return {
    userId: id, source: 'session', scopes: ['*'], isAIAgent,
    user: { id, email: `${id}@example.test`, name: id, isAIAgent }, agentUser: null,
  }
}

const project = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT_ID, ownerId: 'owner', goalsAndGuardrails: goals,
  members: [{ userId: 'padmin', role: 'ADMIN' }, { userId: 'pmember', role: 'member' }],
  lists: [],
  ...overrides,
})

const list = (overrides: Record<string, unknown> = {}) => ({
  id: LIST_ID, ownerId: 'owner', privacy: 'PRIVATE', publicListType: null, listType: 'regular', isVirtual: false,
  projectId: PROJECT_ID,
  listMembers: [{ userId: 'plain', role: 'member' }, { userId: 'claude-agent', role: 'member' }],
  project: project(),
  ...overrides,
})

const projectParams = { params: Promise.resolve({ id: PROJECT_ID }) }
const listParams = { params: Promise.resolve({ id: LIST_ID }) }
const get = (url: string) => new NextRequest(`http://localhost${url}`)
const put = (body: unknown) =>
  new NextRequest(`http://localhost/api/v1/projects/${PROJECT_ID}/goals`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireScopes).mockReturnValue(undefined)
  vi.mocked(prisma.project.findUnique).mockResolvedValue(project() as never)
  vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list() as never)
})

describe('GET /api/v1/projects/:id/goals (ADEV-179)', () => {
  it('answers the stored goals to a member, who cannot edit', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('pmember') as never)
    const response = await getProject(get(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ projectId: PROJECT_ID, goals, canEdit: false, meta: { apiVersion: 'v1' } })
  })

  it('is 404 for someone with no part in the project', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getProject(get(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).status).toBe(404)
  })

  it('a stored row that no longer validates reads as nothing stated', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ goalsAndGuardrails: { goals: [{ id: 'x' }] } }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const body = await (await getProject(get(`/api/v1/projects/${PROJECT_ID}/goals`), projectParams)).json()
    expect(body.goals).toBeNull()
  })
})

describe('PUT /api/v1/projects/:id/goals (ADEV-179)', () => {
  it('an admin stores the normalised value', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('padmin') as never)
    const response = await putProject(put({ goals: { goals: [{ id: ' g1 ', statement: ' Be fast ' }] } }), projectParams)
    expect(response.status).toBe(200)
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { goalsAndGuardrails: { goals: [{ id: 'g1', statement: 'Be fast' }], guardrails: [] } },
    })
  })

  it('null clears the column rather than storing a JSON null', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    expect((await putProject(put({ goals: null }), projectParams)).status).toBe(200)
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: PROJECT_ID }, data: { goalsAndGuardrails: Prisma.DbNull } })
  })

  it('a plain member cannot edit', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('pmember') as never)
    expect((await putProject(put({ goals }), projectParams)).status).toBe(403)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('an agent cannot edit, even as the owner\'s token', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner', true) as never)
    expect((await putProject(put({ goals }), projectParams)).status).toBe(403)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('refuses a bad value with 400 and stores nothing', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await putProject(put({ goals: { guardrails: [{ id: 'r', statement: 'x', kind: 'suggested' }] } }), projectParams)
    expect(response.status).toBe(400)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('a body with no goals key is a 400, not a clear', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    expect((await putProject(put({}), projectParams)).status).toBe(400)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/lists/:id/goals (ADEV-179)', () => {
  it('an agent on the list reads its project\'s goals, with the text for a prompt', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('claude-agent', true) as never)
    const response = await getList(get(`/api/v1/lists/${LIST_ID}/goals`), listParams)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ listId: LIST_ID, projectId: PROJECT_ID, goals, canEdit: false })
    expect(body.text).toContain('Maximise long-term returns (IRR: ≥ 8%/yr)')
  })

  it('a list with no project states no goals', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ projectId: null, project: null }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    expect(await (await getList(get(`/api/v1/lists/${LIST_ID}/goals`), listParams)).json()).toMatchObject({ goals: null, text: '' })
  })

  it('is 404 for someone with no role on the list, public or not', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ privacy: 'PUBLIC' }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getList(get(`/api/v1/lists/${LIST_ID}/goals`), listParams)).status).toBe(404)
  })
})
