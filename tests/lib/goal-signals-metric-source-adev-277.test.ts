/**
 * ADEV-277: the `astrid.metric-source/v1` client signs its request, honours the contract's error
 * rules, and never turns a malformed value into a reading.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  METRIC_SOURCE_MAX_BYTES,
  parseRetryAfter,
  queryMetricSource,
  type MetricSourceTarget,
} from '@/lib/goal-signals-metric-source'

const NOW = new Date('2026-11-25T17:00:00Z')
const target: MetricSourceTarget = { baseUrl: 'https://metrics.example.com/api/', credential: 'secret-key', userSuppliedUrl: false }
const ask = [{ key: 'checkout_conversion' }]
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const run = (fetchImpl: typeof fetch, t = target) => queryMetricSource(t, ask, { fetchImpl, now: () => NOW, requestId: 'req-1' })

describe('queryMetricSource (ADEV-277)', () => {
  it('posts the contract envelope, signed, with the bearer credential', async () => {
    const fetchImpl = vi.fn(async () => json({ metrics: [] }))
    await run(fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://metrics.example.com/api/metrics/query')
    expect(JSON.parse(init.body as string)).toEqual({
      contract: 'astrid.metric-source/v1',
      requestId: 'req-1',
      asOf: '2026-11-25T17:00:00.000Z',
      metrics: [{ key: 'checkout_conversion' }],
    })
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret-key')
    expect(headers['X-Astrid-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(headers['X-Astrid-Timestamp']).toBeTruthy()
    expect(init.redirect).toBe('manual')
  })

  it('sends no signature and no bearer when there is no credential', async () => {
    const fetchImpl = vi.fn(async () => json({ metrics: [] }))
    await run(fetchImpl as unknown as typeof fetch, { ...target, credential: null })
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Astrid-Signature']).toBeUndefined()
  })

  it('reads an ok reading, and the no_data and unknown_metric statuses', async () => {
    const result = await queryMetricSource(
      target,
      [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
      {
        now: () => NOW,
        fetchImpl: (async () =>
          json({
            metrics: [
              { key: 'a', status: 'ok', value: 6.1, unit: '%', at: '2026-11-25T16:00:00Z', url: 'https://dash.example.com/a', extra: 'ignored' },
              { key: 'b', status: 'no_data' },
              { key: 'c', status: 'unknown_metric' },
            ],
          })) as unknown as typeof fetch,
      },
    )
    expect(result).toEqual({
      ok: true,
      readings: [
        { key: 'a', status: 'ok', value: 6.1, unit: '%', at: '2026-11-25T16:00:00.000Z', url: 'https://dash.example.com/a' },
        { key: 'b', status: 'no_data' },
        { key: 'c', status: 'unknown_metric' },
      ],
    })
  })

  it('drops a reading that is not a finite number, has no readable time, or is dated in the future', async () => {
    const result = await queryMetricSource(
      target,
      [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }],
      {
        now: () => NOW,
        fetchImpl: (async () =>
          json({
            metrics: [
              { key: 'a', status: 'ok', value: 'lots', at: '2026-11-25T16:00:00Z' },
              { key: 'b', status: 'ok', value: 1 },
              { key: 'c', status: 'ok', value: 1, at: '2026-11-26T16:00:00Z' },
              { key: 'd', status: 'ok', value: null, at: '2026-11-25T16:00:00Z' },
              { key: 'not-asked', status: 'ok', value: 1, at: '2026-11-25T16:00:00Z' },
              { key: 'e', status: 'ok', value: '4.5', at: '2026-11-25T16:00:00Z' },
            ],
          })) as unknown as typeof fetch,
      },
    )
    expect(result).toMatchObject({ ok: true, readings: [{ key: 'e', value: 4.5 }] })
  })

  it('treats a 4xx as not retried, a 429 as retry with Retry-After, and a 5xx as retry', async () => {
    expect(await run((async () => new Response('no', { status: 401 })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'client', status: 401 })
    expect(
      await run((async () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } })) as unknown as typeof fetch),
    ).toMatchObject({ ok: false, kind: 'retry', status: 429, retryAfterSeconds: 120 })
    expect(await run((async () => new Response('boom', { status: 503 })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'retry', status: 503 })
  })

  it('does not follow a redirect', async () => {
    const result = await run((async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } })) as unknown as typeof fetch)
    expect(result).toMatchObject({ ok: false, kind: 'client', status: 302 })
  })

  it('treats a timeout or a network error as retry', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    expect(await run((async () => { throw timeout }) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'retry' })
    expect(await run((async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'retry' })
  })

  it('refuses a response over 256 KB, whether declared or streamed', async () => {
    const declared = new Response('{}', { status: 200, headers: { 'content-length': String(METRIC_SOURCE_MAX_BYTES + 1) } })
    expect(await run((async () => declared) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
    const streamed = new Response('x'.repeat(METRIC_SOURCE_MAX_BYTES + 10), { status: 200 })
    expect(await run((async () => streamed) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('refuses a body that is not JSON, has no metrics list, or names another major version', async () => {
    expect(await run((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await run((async () => json({ nope: true })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await run((async () => json({ contract: 'astrid.metric-source/v2', metrics: [] })) as unknown as typeof fetch)).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('passes a typed URL through the outbound guard and never calls a private address', async () => {
    const fetchImpl = vi.fn()
    const result = await queryMetricSource(
      { baseUrl: 'https://127.0.0.1:9000', credential: null, userSuppliedUrl: true },
      ask,
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(result).toMatchObject({ ok: false, kind: 'client' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('parseRetryAfter (ADEV-277)', () => {
  it('reads seconds and HTTP dates, and ignores junk', () => {
    expect(parseRetryAfter('30', NOW)).toBe(30)
    expect(parseRetryAfter('Wed, 25 Nov 2026 17:01:00 GMT', NOW)).toBe(60)
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
    expect(parseRetryAfter(null, NOW)).toBeUndefined()
  })
})
