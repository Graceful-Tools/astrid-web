/**
 * Route tests for the cron routes and the admin waiting report no test
 * referenced (ADEV-293): /api/cron/jobs, /api/cron/waiting-settle,
 * /api/cron/goal-signals-poll, /api/admin/waiting-report, plus the v1
 * secure-files re-exports.
 *
 * Cron routes: no Authorization header -> 401, correct secret -> the job runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  drainJobs: vi.fn(),
  runWaitingSettleJob: vi.fn(),
  expireAgentClaimLeases: vi.fn(),
  notifyQuietAgents: vi.fn(),
  pollGoalMetrics: vi.fn(),
  capabilityGate: vi.fn(),
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/cron-observability', () => ({
  runCronJob: async (_name: string, fn: () => Promise<unknown>) => Response.json({ success: true, ...(await fn() as object) }),
}))
vi.mock('@/lib/jobs/queue', () => ({ drainJobs: m.drainJobs }))
vi.mock('@/services/waiting-settle-job', () => ({ runWaitingSettleJob: m.runWaitingSettleJob }))
vi.mock('@/services/agent-claim-lease.service', () => ({ expireAgentClaimLeases: m.expireAgentClaimLeases }))
vi.mock('@/services/agent-presence.service', () => ({ notifyQuietAgents: m.notifyQuietAgents }))
vi.mock('@/lib/goal-signals-poll', () => ({ pollGoalMetrics: m.pollGoalMetrics }))
vi.mock('@/lib/brand/capabilities', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  capabilityGate: m.capabilityGate,
}))
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: m.authenticateAPI,
    requireScopes: m.requireScopes,
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})
vi.mock('@/lib/admin-auth', () => {
  class AdminAuthError extends Error {}
  return { AdminAuthError, requireAdmin: m.requireAdmin }
})

import { GET as jobs } from '@/app/api/cron/jobs/route'
import { GET as waitingSettle } from '@/app/api/cron/waiting-settle/route'
import { GET as goalSignalsPoll } from '@/app/api/cron/goal-signals-poll/route'
import { GET as waitingReport } from '@/app/api/admin/waiting-report/route'
import { POST as v1UploadUrl } from '@/app/api/v1/secure-files/[fileId]/upload-url/route'
import { POST as v1ConfirmUpload } from '@/app/api/v1/secure-files/[fileId]/confirm-upload/route'
import { POST as legacyUploadUrl } from '@/app/api/secure-files/[fileId]/upload-url/route'
import { POST as legacyConfirmUpload } from '@/app/api/secure-files/[fileId]/confirm-upload/route'
import { AdminAuthError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const SECRET = 'test-cron-secret'
const cronReq = (path: string, authorized: boolean) =>
  new NextRequest(`http://localhost${path}`, {
    headers: authorized ? { authorization: `Bearer ${SECRET}` } : {},
  })

const settleReport = {
  settleMode: 'dry-run',
  backfillMode: 'dry-run',
  nativeEnforcement: 'off',
  scanned: 4,
  settle: { counts: { wakeToReady: 1 }, heldForBackfill: 0, applied: false },
  backfill: { counts: { unassign: 0, toInbox: 0, toDoing: 0 }, applied: false },
}

const originalSecret = process.env.CRON_SECRET
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  m.capabilityGate.mockReturnValue(null)
  m.drainJobs.mockResolvedValue({ processed: 2 })
  m.runWaitingSettleJob.mockResolvedValue(settleReport)
  m.expireAgentClaimLeases.mockResolvedValue({ scanned: 3, released: 1, cleared: 0 })
  m.notifyQuietAgents.mockResolvedValue({ notified: 0 })
  m.pollGoalMetrics.mockResolvedValue({ polled: 5 })
})
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

describe('GET /api/cron/jobs (ADEV-293)', () => {
  it('401 without the cron secret, and drains nothing', async () => {
    expect((await jobs(cronReq('/api/cron/jobs', false))).status).toBe(401)
    expect(m.drainJobs).not.toHaveBeenCalled()
  })

  it('fails closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    expect((await jobs(cronReq('/api/cron/jobs', true))).status).toBe(401)
    expect(m.drainJobs).not.toHaveBeenCalled()
  })

  it('drains the queue once with the secret', async () => {
    const res = await jobs(cronReq('/api/cron/jobs', true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ processed: 2 })
    expect(m.drainJobs).toHaveBeenCalledWith({ limit: 10 })
  })
})

describe('GET /api/cron/waiting-settle (ADEV-293)', () => {
  it('401 without the cron secret', async () => {
    expect((await waitingSettle(cronReq('/api/cron/waiting-settle', false))).status).toBe(401)
    expect(m.runWaitingSettleJob).not.toHaveBeenCalled()
  })

  it('reports counts only, including the lease sweep', async () => {
    const res = await waitingSettle(cronReq('/api/cron/waiting-settle', true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scanned: 4, settleWake: 1, leasesExpired: 3, leasesReleased: 1, quietAgentsNotified: 0 })
  })

  it('a failing lease sweep does not fail the settle', async () => {
    m.expireAgentClaimLeases.mockRejectedValue(new Error('boom'))
    const res = await waitingSettle(cronReq('/api/cron/waiting-settle', true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ leasesExpired: -1, leasesReleased: 0 })
  })
})

describe('GET /api/cron/goal-signals-poll (ADEV-293)', () => {
  it('401 without the cron secret', async () => {
    expect((await goalSignalsPoll(cronReq('/api/cron/goal-signals-poll', false))).status).toBe(401)
    expect(m.pollGoalMetrics).not.toHaveBeenCalled()
  })

  it('runs nothing when the capability is off', async () => {
    m.capabilityGate.mockReturnValue(Response.json({ error: 'Not found' }, { status: 404 }))
    expect((await goalSignalsPoll(cronReq('/api/cron/goal-signals-poll', true))).status).toBe(404)
    expect(m.pollGoalMetrics).not.toHaveBeenCalled()
  })

  it('polls with the secret', async () => {
    const res = await goalSignalsPoll(cronReq('/api/cron/goal-signals-poll', true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ polled: 5 })
  })
})

describe('GET /api/admin/waiting-report (ADEV-293)', () => {
  const call = (query = '') => waitingReport(new NextRequest(`http://localhost/api/admin/waiting-report${query}`), undefined as never)

  beforeEach(() => {
    m.authenticateAPI.mockResolvedValue({
      userId: 'admin-1',
      source: 'oauth',
      scopes: ['*'],
      isAIAgent: false,
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    m.requireScopes.mockReturnValue(undefined)
    m.requireAdmin.mockResolvedValue(undefined)
  })

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call()).status).toBe(401)
    expect(m.runWaitingSettleJob).not.toHaveBeenCalled()
  })

  it('403 for a non-admin, and no report is built', async () => {
    m.requireAdmin.mockRejectedValue(new AdminAuthError('Admin only'))
    const res = await call()
    expect(res.status).toBe(403)
    expect(m.runWaitingSettleJob).not.toHaveBeenCalled()
  })

  it('always plans a dry run for the asking admin', async () => {
    const res = await call('?enforcement=bogus')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.detailScope).toEqual({ boardsOwnedBy: 'admin@example.com' })
    expect(m.runWaitingSettleJob).toHaveBeenCalledWith(
      expect.objectContaining({ settleMode: 'dry-run', backfillMode: 'dry-run', readerId: 'admin-1' }),
    )
  })
})

describe('v1 secure-files mount points (ADEV-293)', () => {
  it('re-export the legacy upload handlers, so one test of the legacy route covers both', () => {
    expect(v1UploadUrl).toBe(legacyUploadUrl)
    expect(v1ConfirmUpload).toBe(legacyConfirmUpload)
  })
})
