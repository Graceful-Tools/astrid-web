/**
 * ADEV-279: the client for `astrid.experiment-source/v1` sends the contract request signed, with the
 * project's goals and guardrails, never follows a redirect, and sorts every failure by what to do next.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

import { contractGoalsAndGuardrails, fetchExperimentStatus } from '@/lib/experiment-source-client'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

const NOW = new Date('2026-11-26T12:00:00Z')
const target = { baseUrl: 'https://exp.example.com/api/', credential: 'secret', userSuppliedUrl: false }
const stated: GoalsAndGuardrails = {
  goals: [
    { id: 'g1', statement: 'Convert', metric: { direction: 'up', target: 8, source: { connectorId: 'mc', metricKey: 'conv' } } },
    { id: 'g2', statement: 'Prose only' },
  ],
  guardrails: [
    { id: 'r1', statement: 'Fast', kind: 'enforced', check: { type: 'metric', source: { connectorId: 'mc', metricKey: 'p95' }, op: '<=', threshold: 400 } },
    { id: 'r2', statement: 'Be kind', kind: 'stated' },
  ],
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch
const entry = { key: 'exp-1', state: 'concluded', at: '2026-11-26T11:00:00Z', verdict: 'improving' }

describe('contractGoalsAndGuardrails (ADEV-279)', () => {
  it('sends only the goals and guardrails that have a metric to compare against', () => {
    expect(contractGoalsAndGuardrails(stated)).toEqual({
      goals: [{ id: 'g1', metricKey: 'conv', direction: 'up', target: 8 }],
      guardrails: [{ id: 'r1', metricKey: 'p95', op: '<=', threshold: 400 }],
    })
  })
})

describe('fetchExperimentStatus (ADEV-279)', () => {
  it('posts the contract request, signed and bearer-authenticated, to {base}/experiments/status', async () => {
    const fetchImpl = vi.fn(json({ experiments: [entry] }))
    const out = await fetchExperimentStatus(target, 'exp-1', stated, { fetchImpl, now: () => NOW, requestId: 'req-1' })
    expect(out).toMatchObject({ ok: true, reading: { state: 'concluded', verdict: 'improving' } })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://exp.example.com/api/experiments/status')
    expect(init.redirect).toBe('manual')
    expect(init.headers.Authorization).toBe('Bearer secret')
    expect(init.headers['X-Astrid-Signature']).toBeTruthy()
    expect(JSON.parse(init.body as string)).toEqual({
      contract: 'astrid.experiment-source/v1',
      requestId: 'req-1',
      experiments: [{ key: 'exp-1' }],
      goals: [{ id: 'g1', metricKey: 'conv', direction: 'up', target: 8 }],
      guardrails: [{ id: 'r1', metricKey: 'p95', op: '<=', threshold: 400 }],
    })
  })

  it('sends no credential header when the connector has none', async () => {
    const fetchImpl = vi.fn(json({ experiments: [entry] }))
    await fetchExperimentStatus({ ...target, credential: null }, 'exp-1', stated, { fetchImpl, now: () => NOW })
    const init = fetchImpl.mock.calls[0][1] as unknown as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('sorts failures: 4xx is not retried, 429 and 5xx are, a redirect is refused', async () => {
    const run = (fetchImpl: typeof fetch) => fetchExperimentStatus(target, 'exp-1', stated, { fetchImpl, now: () => NOW })
    expect(await run(json({}, 403))).toMatchObject({ ok: false, kind: 'client', status: 403 })
    expect(await run(json({}, 302, { location: 'https://evil.example.com' }))).toMatchObject({ ok: false, kind: 'client', status: 302 })
    expect(await run(json({}, 429, { 'retry-after': '30' }))).toMatchObject({ ok: false, kind: 'retry', retryAfterSeconds: 30 })
    expect(await run(json({}, 503))).toMatchObject({ ok: false, kind: 'retry', status: 503 })
    expect(await run((async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'retry' })
  })

  it('refuses a reply that is not the contract', async () => {
    const run = (fetchImpl: typeof fetch) => fetchExperimentStatus(target, 'exp-1', stated, { fetchImpl, now: () => NOW })
    expect(await run((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await run(json({ contract: 'astrid.experiment-source/v2', experiments: [entry] }))).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await run(json({ experiments: [{ ...entry, key: 'someone-else' }] }))).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await run(json({ experiments: [{ ...entry, at: 'soon' }] }))).toMatchObject({ ok: false, kind: 'invalid' })
    const big = (async () => new Response('x'.repeat(10), { status: 200, headers: { 'content-length': String(300 * 1024) } })) as unknown as typeof fetch
    expect(await run(big)).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('a URL a person typed passes the outbound guard on every call', async () => {
    const out = await fetchExperimentStatus({ ...target, baseUrl: 'https://127.0.0.1/api', userSuppliedUrl: true }, 'exp-1', stated, {
      fetchImpl: vi.fn() as never,
      now: () => NOW,
    })
    expect(out).toMatchObject({ ok: false, kind: 'client' })
  })
})
