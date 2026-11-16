/**
 * AWTD-1693 — the orchestration policy over v1: stored on the project, overridable per list,
 * readable by anyone on the list, editable only by owners and admins (never an agent).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { GET as getList, PUT as putList } from '@/app/api/v1/lists/[id]/orchestration-policy/route'
import { GET as getProject, PUT as putProject } from '@/app/api/v1/projects/[id]/orchestration-policy/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { defaultOrchestrationPolicy } from '@/lib/orchestration-policy'
import { Prisma } from '@prisma/client'

const LIST_ID = 'list-1'
const PROJECT_ID = 'project-1'

function person(id: string, isAIAgent = false) {
  return {
    userId: id, source: 'session', scopes: ['*'], isAIAgent,
    user: { id, email: `${id}@example.test`, name: id, isAIAgent }, agentUser: null,
  }
}

const member = (userId: string, role: string) => ({ userId, role, user: { id: userId, email: `${userId}@example.test`, name: userId } })

function list(overrides: Record<string, unknown> = {}) {
  return {
    id: LIST_ID, ownerId: 'owner', privacy: 'PRIVATE', publicListType: null, listType: 'regular', isVirtual: false,
    projectId: PROJECT_ID, orchestrationPolicy: null,
    listMembers: [member('admin', 'admin'), member('plain', 'member'), member('claude-agent', 'member')],
    project: {
      id: PROJECT_ID, ownerId: 'owner', members: [], lists: [],
      orchestrationPolicy: { autonomy: { merge: 'allowed', deploy: 'ask' } },
    },
    ...overrides,
  }
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID, ownerId: 'owner', orchestrationPolicy: null,
    members: [{ userId: 'padmin', role: 'ADMIN' }, { userId: 'pmember', role: 'member' }],
    lists: [{ ownerId: 'owner', listMembers: [{ userId: 'plain' }] }],
    ...overrides,
  }
}

const listParams = { params: Promise.resolve({ id: LIST_ID }) }
const projectParams = { params: Promise.resolve({ id: PROJECT_ID }) }
const req = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, body === undefined ? undefined : {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireScopes).mockReturnValue(undefined)
  vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list() as never)
  vi.mocked(prisma.project.findUnique).mockResolvedValue(project() as never)
})

describe('GET /api/v1/lists/:id/orchestration-policy (AWTD-1693)', () => {
  it('answers both stored overrides and the effective policy, the project\'s inherited', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ orchestrationPolicy: { autonomy: { merge: 'ask' } } }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('plain') as never)
    const response = await getList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`), listParams)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      listId: LIST_ID, projectId: PROJECT_ID,
      list: { autonomy: { merge: 'ask' } },
      project: { autonomy: { merge: 'allowed', deploy: 'ask' } },
      canEdit: { list: false, project: false },
      meta: { apiVersion: 'v1' },
    })
    expect(body.effective.autonomy).toMatchObject({ merge: 'ask', deploy: 'ask', release: 'never' })
    expect(body.effective.escalation).toEqual({ to: 'listOwner' })
  })

  it('nothing stored anywhere is today\'s behaviour', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ projectId: null, project: null }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const body = await (await getList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`), listParams)).json()
    expect(body.effective).toEqual(defaultOrchestrationPolicy())
    expect(body.canEdit).toEqual({ list: true, project: false })
  })

  it('is 404 for someone with no role on the list, public or not', async () => {
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue(list({ privacy: 'PUBLIC' }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`), listParams)).status).toBe(404)
  })
})

describe('PUT /api/v1/lists/:id/orchestration-policy (AWTD-1693)', () => {
  it('an admin stores the list override, and the answer is the new effective policy', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('admin') as never)
    const policy = { autonomy: { merge: 'ask' }, routing: { assignTo: 'codex' }, escalation: { to: 'people', userIds: ['plain'] } }
    const response = await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy }), listParams)
    expect(response.status).toBe(200)
    expect(prisma.taskList.update).toHaveBeenCalledWith({ where: { id: LIST_ID }, data: { orchestrationPolicy: policy } })
    const body = await response.json()
    expect(body.effective).toMatchObject({
      routing: { assignTo: 'codex', agents: null },
      autonomy: { merge: 'ask', deploy: 'ask' },
      escalation: { to: 'people', userIds: ['plain'] },
    })
  })

  it('null clears it to SQL NULL, not a stored JSON null', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy: null }), listParams)
    expect(response.status).toBe(200)
    expect(prisma.taskList.update).toHaveBeenCalledWith({ where: { id: LIST_ID }, data: { orchestrationPolicy: Prisma.DbNull } })
  })

  it('a plain member may not', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('plain') as never)
    const response = await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy: { autonomy: { merge: 'allowed' } } }), listParams)
    expect(response.status).toBe(403)
    expect(prisma.taskList.update).not.toHaveBeenCalled()
  })

  it('an agent may not, even acting for an owner', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue({
      ...person('owner'), source: 'oauth',
      agentUser: { id: 'claude-agent', email: 'claude@example.test', name: 'Claude', isAIAgent: true },
    } as never)
    const response = await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy: { autonomy: { merge: 'allowed' } } }), listParams)
    expect(response.status).toBe(403)
    expect(prisma.taskList.update).not.toHaveBeenCalled()
  })

  it('refuses a value the rules do not know, and a body without policy', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const bad = await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy: { autonomy: { merge: 'sometimes' } } }), listParams)
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain('unknown variant `sometimes`')
    expect((await putList(req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { autonomy: {} }), listParams)).status).toBe(400)
    expect(prisma.taskList.update).not.toHaveBeenCalled()
  })

  it('questions only go to people on the list', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner') as never)
    const response = await putList(
      req(`/api/v1/lists/${LIST_ID}/orchestration-policy`, { policy: { escalation: { to: 'people', userIds: ['stranger'] } } }),
      listParams,
    )
    expect(response.status).toBe(400)
    expect(prisma.taskList.update).not.toHaveBeenCalled()
  })
})

describe('/api/v1/projects/:id/orchestration-policy (AWTD-1693)', () => {
  it('a member reads it; the effective policy is the project\'s over the default', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ orchestrationPolicy: { autonomy: { deploy: 'allowed' } } }) as never)
    vi.mocked(authenticateAPI).mockResolvedValue(person('pmember') as never)
    const body = await (await getProject(req(`/api/v1/projects/${PROJECT_ID}/orchestration-policy`), projectParams)).json()
    expect(body).toMatchObject({ projectId: PROJECT_ID, project: { autonomy: { deploy: 'allowed' } }, canEdit: false })
    expect(body.effective.autonomy).toMatchObject({ deploy: 'allowed', merge: 'never' })
  })

  it('is 404 for someone outside the project', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('stranger') as never)
    expect((await getProject(req(`/api/v1/projects/${PROJECT_ID}/orchestration-policy`), projectParams)).status).toBe(404)
  })

  it('a project admin stores it (role casing does not matter); a plain member may not', async () => {
    const policy = { autonomy: { merge: 'allowed' }, escalation: { to: 'people', userIds: ['plain'] } }
    vi.mocked(authenticateAPI).mockResolvedValue(person('padmin') as never)
    expect((await putProject(req(`/api/v1/projects/${PROJECT_ID}/orchestration-policy`, { policy }), projectParams)).status).toBe(200)
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: PROJECT_ID }, data: { orchestrationPolicy: policy } })

    vi.mocked(prisma.project.update).mockClear()
    vi.mocked(authenticateAPI).mockResolvedValue(person('pmember') as never)
    expect((await putProject(req(`/api/v1/projects/${PROJECT_ID}/orchestration-policy`, { policy }), projectParams)).status).toBe(403)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('an agent may not write it', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(person('owner', true) as never)
    const response = await putProject(req(`/api/v1/projects/${PROJECT_ID}/orchestration-policy`, { policy: null }), projectParams)
    expect(response.status).toBe(403)
  })
})
