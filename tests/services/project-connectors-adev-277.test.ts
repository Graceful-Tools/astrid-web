/**
 * ADEV-277: only a project's owner or admin manages its connectors, a credential is stored encrypted
 * and never returned, and a typed URL must pass the outbound guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  projectConnector: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
// A name that resolves publicly, so the outbound guard passes without a network.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

import {
  connectorView,
  createConnector,
  deleteConnector,
  listConnectors,
  testConnector,
  updateConnector,
} from '@/services/project-connectors.service'
import { decryptField } from '@/lib/field-encryption'

const project = { id: 'p1', ownerId: 'owner', members: [{ userId: 'admin', role: 'admin' }, { userId: 'member', role: 'member' }] }
const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  projectId: 'p1',
  kind: 'metric',
  serviceKey: 'acme',
  name: 'Acme',
  endpointUrl: null,
  credentialEnc: null,
  config: null,
  state: 'ok',
  lastOkAt: null,
  lastError: null,
  lastPolledAt: null,
  createdAt: new Date('2026-11-25T00:00:00Z'),
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ASTRID_SIGNAL_SERVICES = JSON.stringify([{ key: 'acme', kind: 'metric', name: 'Acme', baseUrl: 'https://acme.example.com', secretEnv: 'ACME_KEY' }])
  process.env.ACME_KEY = 'k'
  delete process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS
  prismaMock.project.findUnique.mockResolvedValue(project)
  prismaMock.projectConnector.count.mockResolvedValue(0)
  prismaMock.projectConnector.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row(data))
})

describe('who may manage connectors (ADEV-277)', () => {
  it('lets the owner and an admin list them', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([row()])
    expect((await listConnectors('p1', 'owner')).ok).toBe(true)
    expect((await listConnectors('p1', 'admin')).ok).toBe(true)
  })

  it('answers a plain member 403 and a stranger 404, on every operation', async () => {
    for (const run of [
      (u: string) => listConnectors('p1', u),
      (u: string) => createConnector('p1', u, { kind: 'metric', serviceKey: 'acme' }),
      (u: string) => updateConnector('p1', 'c1', u, { name: 'x' }),
      (u: string) => deleteConnector('p1', 'c1', u),
      (u: string) => testConnector('p1', 'c1', u, {}),
    ]) {
      expect(await run('member')).toMatchObject({ ok: false, status: 403 })
      expect(await run('stranger')).toMatchObject({ ok: false, status: 404 })
    }
    expect(prismaMock.projectConnector.create).not.toHaveBeenCalled()
    expect(prismaMock.projectConnector.deleteMany).not.toHaveBeenCalled()
  })
})

describe('creating a connector (ADEV-277)', () => {
  it('binds a service the environment defines, and takes no credential for it', async () => {
    const made = await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'acme', name: ' Revenue ' })
    expect(made).toMatchObject({ ok: true, value: { serviceKey: 'acme', name: 'Revenue', hasCredential: true } })
    expect(await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'acme', credential: 'x' })).toMatchObject({ ok: false, status: 400 })
    expect(await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'nope' })).toMatchObject({ ok: false, status: 400 })
    expect(await createConnector('p1', 'owner', { kind: 'estimator', serviceKey: 'acme' })).toMatchObject({ ok: false, status: 400 })
    expect(await createConnector('p1', 'owner', { kind: 'bogus', serviceKey: 'acme' })).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a custom endpoint unless the deployment allows it', async () => {
    expect(await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'custom', endpointUrl: 'https://metrics.example.com' })).toMatchObject({ ok: false, status: 400 })
  })

  it('stores a custom credential encrypted and never returns it', async () => {
    process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS = 'true'
    const made = await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'custom', endpointUrl: 'https://metrics.example.com/api', credential: 'super-secret' })
    expect(made.ok).toBe(true)
    const data = prismaMock.projectConnector.create.mock.calls[0][0].data
    expect(data.credentialEnc).toBeTruthy()
    expect(data.credentialEnc).not.toContain('super-secret')
    expect(decryptField(data.credentialEnc)).toBe('super-secret')
    expect(JSON.stringify(made)).not.toContain('super-secret')
    expect(JSON.stringify(made)).not.toContain(data.credentialEnc)
    expect(made.ok && made.value.hasCredential).toBe(true)
  })

  it('refuses a custom endpoint that points at a private address', async () => {
    process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS = 'true'
    for (const url of ['https://127.0.0.1/x', 'https://10.0.0.5/x', 'http://metrics.example.com', 'https://user:pw@metrics.example.com']) {
      expect(await createConnector('p1', 'owner', { kind: 'metric', serviceKey: 'custom', endpointUrl: url })).toMatchObject({ ok: false, status: 400 })
    }
    expect(prismaMock.projectConnector.create).not.toHaveBeenCalled()
  })
})

describe('connectorView (ADEV-277)', () => {
  it('never carries the credential', () => {
    const view = connectorView(row({ serviceKey: 'custom', credentialEnc: 'enc:v1:abc', endpointUrl: 'https://x.example.com' }))
    expect(view.hasCredential).toBe(true)
    expect(Object.keys(view)).not.toContain('credentialEnc')
    expect(JSON.stringify(view)).not.toContain('enc:v1:abc')
  })
})

describe('updating and testing (ADEV-277)', () => {
  it('removes a stored credential with null, and refuses endpoint edits on an environment service', async () => {
    prismaMock.projectConnector.findFirst.mockResolvedValue(row({ serviceKey: 'custom', credentialEnc: 'enc' }))
    prismaMock.projectConnector.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ serviceKey: 'custom', ...data }))
    const cleared = await updateConnector('p1', 'c1', 'owner', { credential: null })
    expect(prismaMock.projectConnector.update.mock.calls[0][0].data).toMatchObject({ credentialEnc: null, state: 'ok' })
    expect(cleared.ok && cleared.value.hasCredential).toBe(false)

    prismaMock.projectConnector.findFirst.mockResolvedValue(row())
    expect(await updateConnector('p1', 'c1', 'owner', { endpointUrl: 'https://x.example.com' })).toMatchObject({ ok: false, status: 400 })
  })

  it('tests a connector once and records how it went', async () => {
    prismaMock.projectConnector.findFirst.mockResolvedValue(row())
    prismaMock.projectConnector.update.mockResolvedValue({})
    prismaMock.projectConnector.findUnique.mockResolvedValue(row({ lastOkAt: new Date('2026-11-25T17:00:00Z') }))
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ metrics: [{ key: 'conv', status: 'ok', value: 6.1, unit: '%', at: new Date().toISOString() }] }), { status: 200 })) as unknown as typeof fetch
    const result = await testConnector('p1', 'c1', 'owner', { metricKey: 'conv' }, fetchImpl)
    expect(result).toMatchObject({ ok: true, value: { ok: true, error: null, reading: { key: 'conv', value: 6.1 } } })
    expect(prismaMock.projectConnector.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'ok', lastError: null }) }))
  })

  it('reports a failed call as ok:false with the error recorded', async () => {
    prismaMock.projectConnector.findFirst.mockResolvedValue(row())
    prismaMock.projectConnector.update.mockResolvedValue({})
    prismaMock.projectConnector.findUnique.mockResolvedValue(row({ state: 'error', lastError: 'The service refused the request (401)' }))
    const result = await testConnector('p1', 'c1', 'owner', {}, (async () => new Response('no', { status: 401 })) as unknown as typeof fetch)
    expect(result).toMatchObject({ ok: true, value: { ok: false, error: expect.stringContaining('401') } })
    expect(prismaMock.projectConnector.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'error' }) }))
  })
})
