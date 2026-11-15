/**
 * GET /api/v1/runtime-bindings/[id]/audit-export — the controlled export of one
 * binding's audit trail (AWTD-1670; RFC §7: "Audit reads require a scoped
 * administrative permission and have an explicit retention/export policy").
 *
 *  - deployment admins only (lib/admin-auth.ts), and only with a full-access
 *    credential (a browser session), never a narrowly scoped OAuth token;
 *  - the export is itself audited, BEFORE anything is read: no audit row, no export;
 *  - no secret material leaves, even if a writer put some in `details`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const adminFindUnique = vi.hoisted(() => vi.fn())
const bindingFindUnique = vi.hoisted(() => vi.fn())
const auditCreate = vi.hoisted(() => vi.fn())
const auditFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminUser: { findUnique: adminFindUnique },
    runtimeBinding: { findUnique: bindingFindUnique },
    runtimeBindingAuditEvent: { create: auditCreate, findMany: auditFindMany },
  },
}))

import { GET } from '@/app/api/v1/runtime-bindings/[id]/audit-export/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const URL_BASE = 'http://localhost/api/v1/runtime-bindings/b-1/audit-export'
const get = (query = '', id = 'b-1') =>
  GET(new NextRequest(`${URL_BASE}${query}`), { params: Promise.resolve({ id }) })

const session = (userId: string) => ({ userId, scopes: ['*'], source: 'session', user: { id: userId } })

const BINDING = {
  id: 'b-1', state: 'revoked', revision: 3, createdAt: new Date('2026-08-01T00:00:00Z'),
  revokedAt: new Date('2026-11-01T00:00:00Z'),
}

const EVENTS = [
  {
    id: 'e-1', bindingId: 'b-1', bindingRevision: 1, eventType: 'enrolled', actorUserId: 'admin-1',
    actorPrincipal: null, boardIds: ['list-1', 'list-2'], repositoryRefs: ['gh:1'], reasonCode: null,
    details: {
      scope: 'boards, "two"\nnext line',
      credentialRef: 'cred_opaque_1',
      credentialGeneration: 2,
      apiKey: 'sk-live-SHOULD-NOT-LEAK',
      nested: { authorization: 'Bearer SHOULD-NOT-LEAK', webhookSecret: 'whsec-SHOULD-NOT-LEAK' },
    },
    correlationId: 'corr-1', runId: null, transportOutcome: null, createdAt: new Date('2026-08-01T00:00:00Z'),
  },
  {
    id: 'e-2', bindingId: 'b-1', bindingRevision: 3, eventType: 'resolution-denied', actorUserId: null,
    actorPrincipal: '=cmd|calc', boardIds: [], repositoryRefs: [], reasonCode: 'binding-revoked', details: null,
    correlationId: null, runId: 'run-9', transportOutcome: null, createdAt: new Date('2026-11-02T00:00:00Z'),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  adminFindUnique.mockImplementation(async ({ where }) => (where.userId === 'admin-1' ? { id: 'a', userId: 'admin-1' } : null))
  bindingFindUnique.mockImplementation(async ({ where }) => (where.id === 'b-1' ? BINDING : null))
  auditCreate.mockImplementation(async ({ data }) => ({ id: 'e-export', createdAt: new Date('2026-11-14T00:00:00Z'), ...data }))
  auditFindMany.mockResolvedValue(EVENTS)
})

describe('runtime-binding audit export authorization (AWTD-1670)', () => {
  it('AWTD-1670: refuses an unauthenticated caller with 401 and reads nothing', async () => {
    authenticateAPI.mockRejectedValue(new UnauthorizedError('No valid authentication found'))
    expect((await get()).status).toBe(401)
    expect(auditFindMany).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1670: refuses a signed-in non-admin with 403 and reads nothing', async () => {
    authenticateAPI.mockResolvedValue(session('user-1'))
    expect((await get()).status).toBe(403)
    expect(bindingFindUnique).not.toHaveBeenCalled()
    expect(auditFindMany).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1670: refuses an admin holding only a narrowly scoped OAuth token', async () => {
    authenticateAPI.mockResolvedValue({ userId: 'admin-1', scopes: ['tasks:read', 'lists:read'], source: 'oauth' })
    expect((await get()).status).toBe(403)
    expect(auditFindMany).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1670: answers 404 for a binding that does not exist, and audits nothing', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    expect((await get('', 'missing')).status).toBe(404)
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1670: refuses an unknown format with 400 before writing or reading', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    expect((await get('?format=xml')).status).toBe(400)
    expect(auditCreate).not.toHaveBeenCalled()
    expect(auditFindMany).not.toHaveBeenCalled()
  })
})

describe('runtime-binding audit export is itself audited (AWTD-1670)', () => {
  it('AWTD-1670: writes an audit-exported lifecycle event naming the admin, binding and revision before reading', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    const res = await get('?format=csv')
    expect(res.status).toBe(200)
    expect(auditCreate).toHaveBeenCalledTimes(1)
    const { data } = auditCreate.mock.calls[0][0]
    expect(data).toMatchObject({
      bindingId: 'b-1', bindingRevision: 3, eventType: 'audit-exported', actorUserId: 'admin-1',
      details: { format: 'csv' },
    })
    expect(auditCreate.mock.invocationCallOrder[0]).toBeLessThan(auditFindMany.mock.invocationCallOrder[0])
    expect(res.headers.get('x-audit-event-id')).toBe('e-export')
  })

  it('AWTD-1670: no audit row, no export: a failed audit write refuses and reads nothing', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    auditCreate.mockRejectedValue(new Error('db write failed'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(auditFindMany).not.toHaveBeenCalled()
    expect(await res.text()).not.toContain('enrolled')
  })
})

describe('runtime-binding audit export content (AWTD-1670)', () => {
  it('AWTD-1670: JSON carries the trail, each event classified, uncached, as a download', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="runtime-binding-b-1-audit-.*\.json"$/)
    const body = await res.json()
    expect(body.binding).toMatchObject({ id: 'b-1', state: 'revoked', revision: 3 })
    expect(body.retention).toEqual({ operationalDays: 90, lifecycleDays: 90 })
    expect(body.events.map((e: any) => [e.id, e.retentionClass])).toEqual([['e-1', 'lifecycle'], ['e-2', 'operational']])
    expect(body.truncated).toBe(false)
    expect(auditFindMany.mock.calls[0][0].where).toEqual({ bindingId: 'b-1' })
  })

  it('AWTD-1670: never includes secret-looking values, but keeps opaque references and generations', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    for (const format of ['json', 'csv']) {
      const text = await (await get(`?format=${format}`)).text()
      expect(text, format).not.toContain('SHOULD-NOT-LEAK')
      expect(text, format).toContain('cred_opaque_1')
      expect(text, format).toContain('credentialGeneration')
    }
  })

  it('AWTD-1670: CSV escapes commas, quotes and newlines, and neutralises formulas', async () => {
    authenticateAPI.mockResolvedValue(session('admin-1'))
    const res = await get('?format=csv')
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toMatch(/\.csv"$/)
    const text = await res.text()
    const [header] = text.split('\n')
    expect(header.split(',')).toEqual(expect.arrayContaining(['id', 'createdAt', 'eventType', 'retentionClass', 'details']))
    // Array columns are joined, so a list of boards stays one cell.
    expect(text).toContain('list-1;list-2')
    // details is JSON in one quoted cell: its quotes doubled, the newline kept inside quotes.
    expect(text).toContain('""scope"":""boards, \\""two\\""\\nnext line""')
    // An attacker-influenced principal cannot become a spreadsheet formula.
    expect(text).toContain("'=cmd|calc")
    expect(text).not.toMatch(/(^|,)=cmd/m)
  })
})
