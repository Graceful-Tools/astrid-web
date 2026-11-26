/**
 * Route tests (ADEV-293): POST /api/github/repositories/refresh and
 * POST /api/coding-workflow/approve-plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  getUnifiedSession: vi.fn(),
  capabilityGate: vi.fn(),
  integrationFindMany: vi.fn(),
  integrationUpdate: vi.fn(),
  workflowFindUnique: vi.fn(),
  workflowUpdate: vi.fn(),
  getGitHubApp: vi.fn(),
  recordInstallation: vi.fn(),
  replaceInstallationRepos: vi.fn(),
  createForTask: vi.fn(),
  handlePlanApproval: vi.fn(),
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: m.getUnifiedSession }))
vi.mock('@/lib/brand/capabilities', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  capabilityGate: m.capabilityGate,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    gitHubIntegration: { findMany: m.integrationFindMany, update: m.integrationUpdate },
    codingTaskWorkflow: { findUnique: m.workflowFindUnique, update: m.workflowUpdate },
  },
}))
vi.mock('@/lib/github/app', () => ({ getGitHubApp: m.getGitHubApp }))
vi.mock('@/lib/github/installations', () => ({
  recordInstallation: m.recordInstallation,
  replaceInstallationRepos: m.replaceInstallationRepos,
}))
vi.mock('@/lib/ai-orchestrator', () => ({ AIOrchestrator: { createForTask: m.createForTask } }))
vi.mock('@/lib/api-key-cache', () => ({ getPreferredAIService: vi.fn() }))

import { POST as refresh } from '@/app/api/github/repositories/refresh/route'
import { POST as approvePlan } from '@/app/api/coding-workflow/approve-plan/route'

const post = (url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const saved = { id: process.env.GITHUB_APP_ID, key: process.env.GITHUB_APP_PRIVATE_KEY }
beforeEach(() => {
  vi.clearAllMocks()
  m.getUnifiedSession.mockResolvedValue({ user: { id: 'user-1' } })
  m.capabilityGate.mockReturnValue(null)
})
afterEach(() => {
  for (const [name, value] of [['GITHUB_APP_ID', saved.id], ['GITHUB_APP_PRIVATE_KEY', saved.key]] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('POST /api/github/repositories/refresh (ADEV-293)', () => {
  const call = () => refresh(post('/api/github/repositories/refresh'))

  it('refuses when the deployment has no coding agent, before reading the session', async () => {
    m.capabilityGate.mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await call()).status).toBe(404)
    expect(m.getUnifiedSession).not.toHaveBeenCalled()
  })

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(m.integrationFindMany).not.toHaveBeenCalled()
  })

  it('answers an empty list when the caller has no integrations', async () => {
    m.integrationFindMany.mockResolvedValue([])
    const body = await (await call()).json()
    expect(body.repositories).toEqual([])
    expect(m.integrationFindMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
  })

  it('500 when the GitHub App is not configured', async () => {
    m.integrationFindMany.mockResolvedValue([{ id: 'i1', installationId: 1 }])
    delete process.env.GITHUB_APP_ID
    expect((await call()).status).toBe(500)
    expect(m.getGitHubApp).not.toHaveBeenCalled()
  })

  it('refreshes each installation, caches the list, and falls back to the cache when one fails', async () => {
    process.env.GITHUB_APP_ID = '1'
    process.env.GITHUB_APP_PRIVATE_KEY = 'k'
    m.integrationFindMany.mockResolvedValue([
      { id: 'i1', installationId: 11, repositories: [] },
      { id: 'i2', installationId: 22, repositories: [{ id: 9, name: 'cached', fullName: 'o/cached' }] },
      { id: 'i3', installationId: null },
    ])
    m.getGitHubApp.mockReturnValue({
      getInstallationOctokit: async (id: number) => {
        if (id === 22) throw new Error('suspended')
        return {
          request: async () => ({
            data: { repositories: [{ id: 1, name: 'r', full_name: 'acme/r', default_branch: 'dev', private: true, node_id: 'n' }] },
          }),
        }
      },
      octokit: { request: async () => ({ data: { account: { login: 'acme', type: 'Organization' } } }) },
    })
    const body = await (await call()).json()
    expect(body.integrationCount).toBe(3)
    expect(body.repositories.map((r: { fullName: string }) => r.fullName)).toEqual(['acme/r', 'o/cached'])
    expect(body.repositories[0]).toMatchObject({ owner: 'acme', defaultBranch: 'dev', installationId: 11 })
    expect(body.errors).toHaveLength(1)
    expect(m.integrationUpdate).toHaveBeenCalledTimes(1)
    expect(m.integrationUpdate.mock.calls[0][0].where).toEqual({ id: 'i1' })
  })
})

describe('POST /api/coding-workflow/approve-plan (ADEV-293)', () => {
  const call = (body: unknown) => approvePlan(post('/api/coding-workflow/approve-plan', body))
  const payload = { workflowId: 'w1', commentId: 'c1', taskId: 't1' }
  const workflow = (over: Record<string, unknown> = {}) => ({
    id: 'w1',
    taskId: 't1',
    status: 'AWAITING_APPROVAL',
    task: { creatorId: 'user-1', assigneeId: 'user-2' },
    ...over,
  })

  beforeEach(() => {
    m.workflowFindUnique.mockResolvedValue(workflow())
    m.createForTask.mockResolvedValue({ handlePlanApproval: m.handlePlanApproval })
    m.handlePlanApproval.mockResolvedValue(undefined)
  })

  it('refuses without the capability, and 401 without a session', async () => {
    m.capabilityGate.mockReturnValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await call(payload)).status).toBe(404)
    m.capabilityGate.mockReturnValue(null)
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await call(payload)).status).toBe(401)
    expect(m.workflowUpdate).not.toHaveBeenCalled()
  })

  it('400 for missing fields, 404 for an unknown workflow, 400 when it is not awaiting approval', async () => {
    expect((await call({ workflowId: 'w1' })).status).toBe(400)
    m.workflowFindUnique.mockResolvedValue(null)
    expect((await call(payload)).status).toBe(404)
    m.workflowFindUnique.mockResolvedValue(workflow({ status: 'IMPLEMENTING' }))
    expect((await call(payload)).status).toBe(400)
    expect(m.workflowUpdate).not.toHaveBeenCalled()
  })

  it('403 for someone who is neither the task creator nor the assignee', async () => {
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'stranger' } })
    expect((await call(payload)).status).toBe(403)
    expect(m.createForTask).not.toHaveBeenCalled()
    expect(m.workflowUpdate).not.toHaveBeenCalled()
  })

  it('the creator approves: implementation starts and the workflow is marked approved', async () => {
    const res = await call(payload)
    expect(res.status).toBe(200)
    expect(m.createForTask).toHaveBeenCalledWith('t1', 'user-1')
    expect(m.handlePlanApproval).toHaveBeenCalledWith('w1', 'c1')
    expect(m.workflowUpdate).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { planApproved: true } })
  })

  it('the assignee may approve too', async () => {
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'user-2' } })
    expect((await call(payload)).status).toBe(200)
  })
})
