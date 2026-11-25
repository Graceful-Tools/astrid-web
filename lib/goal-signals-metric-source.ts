/**
 * The client for `astrid.metric-source/v1` (ADEV-277, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → The
 * three contracts → Metric source). Server-only.
 *
 * Astrid calls the service: `POST {base}/metrics/query`, signed with `generateWebhookHeaders` and an
 * optional bearer credential. A URL a person typed passes the outbound guard on every call (a name
 * that resolved publicly yesterday can resolve to 127.0.0.1 today). 10 s, 256 KB, no redirects.
 *
 * The result says what to do next, because the contract's error rules differ by cause:
 * - `client`: a 4xx. Not retried; recorded in the connector's `lastError`.
 * - `retry`: a 429 (with `retryAfterSeconds` when the service said), a 5xx, a timeout or a network
 *   error. The next poll is the retry.
 * - `invalid`: a 2xx that is not the contract. Recorded like a 4xx.
 * A reading is only ever a finite number with a readable `at`; anything else is dropped, never guessed.
 */

import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { assertPublicOutboundUrl } from '@/lib/security/outbound-url'

export const METRIC_SOURCE_CONTRACT = 'astrid.metric-source/v1'
export const METRIC_SOURCE_TIMEOUT_MS = 10_000
export const METRIC_SOURCE_MAX_BYTES = 256 * 1024
export const METRIC_SOURCE_EVENT = 'metrics.query'
/** A reading dated further ahead than this is a clock fault in the sender, not data. */
const FUTURE_SKEW_MS = 5 * 60_000
const KEY_MAX_CHARS = 120

export interface MetricSourceTarget {
  /** `https://host/prefix`, without the contract path. */
  baseUrl: string
  /** Signs the request and rides as the bearer. Null sends it unsigned. */
  credential: string | null
  /** A URL a person entered: it must pass the outbound guard before every call. */
  userSuppliedUrl: boolean
}

export interface MetricQuery {
  key: string
  window?: string
}

export type MetricStatus = 'ok' | 'no_data' | 'unknown_metric'

export interface MetricReading {
  key: string
  status: MetricStatus
  /** Present only when `status` is `ok`, and always finite then. */
  value?: number
  unit?: string
  /** ISO timestamp of the reading. Present with `value`. */
  at?: string
  url?: string
}

export type MetricQueryResult =
  | { ok: true; readings: MetricReading[] }
  | { ok: false; kind: 'client' | 'retry' | 'invalid'; error: string; status?: number; retryAfterSeconds?: number }

export interface MetricQueryOptions {
  fetchImpl?: typeof fetch
  now?: () => Date
  requestId?: string
}

/** Seconds from a `Retry-After` header (delta-seconds or an HTTP date), or undefined. */
export function parseRetryAfter(header: string | null, now: Date): number | undefined {
  if (!header) return undefined
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const when = Date.parse(trimmed)
  if (Number.isNaN(when)) return undefined
  return Math.max(0, Math.ceil((when - now.getTime()) / 1000))
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > METRIC_SOURCE_MAX_BYTES) return null
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > METRIC_SOURCE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Read one entry of the response's `metrics`, or null when it is not a reading of a key we asked for. */
function parseReading(raw: unknown, asked: Set<string>, now: Date): MetricReading | null {
  if (!isRecord(raw) || typeof raw.key !== 'string' || !asked.has(raw.key)) return null
  const status = raw.status
  if (status === 'no_data' || status === 'unknown_metric') return { key: raw.key, status }
  if (status !== 'ok') return null
  const value = typeof raw.value === 'string' && raw.value.trim() ? Number(raw.value) : raw.value
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const at = typeof raw.at === 'string' ? Date.parse(raw.at) : NaN
  if (Number.isNaN(at) || at > now.getTime() + FUTURE_SKEW_MS) return null
  const reading: MetricReading = { key: raw.key, status: 'ok', value, at: new Date(at).toISOString() }
  if (typeof raw.unit === 'string' && raw.unit.trim()) reading.unit = raw.unit.trim().slice(0, KEY_MAX_CHARS)
  if (typeof raw.url === 'string' && /^https:\/\//i.test(raw.url)) reading.url = raw.url.slice(0, 500)
  return reading
}

/** Ask the service for the current value of each metric. Never throws. */
export async function queryMetricSource(
  target: MetricSourceTarget,
  metrics: MetricQuery[],
  options: MetricQueryOptions = {},
): Promise<MetricQueryResult> {
  const now = options.now ?? (() => new Date())
  const doFetch = options.fetchImpl ?? fetch
  const base = target.baseUrl.replace(/\/+$/, '')
  const endpoint = `${base}/metrics/query`

  try {
    if (target.userSuppliedUrl) await assertPublicOutboundUrl(endpoint)
  } catch (error) {
    return { ok: false, kind: 'client', error: error instanceof Error ? error.message : 'URL is not allowed' }
  }

  const body = JSON.stringify({
    contract: METRIC_SOURCE_CONTRACT,
    requestId: options.requestId ?? crypto.randomUUID(),
    asOf: now().toISOString(),
    metrics: metrics.map(m => ({ key: m.key, ...(m.window ? { window: m.window } : {}) })),
  })
  const headers: Record<string, string> = target.credential
    ? { ...generateWebhookHeaders(body, target.credential, METRIC_SOURCE_EVENT), Authorization: `Bearer ${target.credential}` }
    : { 'Content-Type': 'application/json' }

  let response: Response
  try {
    response = await doFetch(endpoint, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(METRIC_SOURCE_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return { ok: false, kind: 'retry', error: timedOut ? 'The service did not answer within 10 seconds' : 'The service could not be reached' }
  }

  const status = response.status
  if (status === 429) {
    return { ok: false, kind: 'retry', status, error: 'The service is rate limiting requests', retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after'), now()) }
  }
  if (status >= 500) return { ok: false, kind: 'retry', status, error: `The service answered ${status}` }
  if (status >= 300) return { ok: false, kind: 'client', status, error: `The service answered ${status}; redirects are not followed` }
  if (status >= 400) return { ok: false, kind: 'client', status, error: `The service refused the request (${status})` }

  const text = await readCapped(response).catch(() => null)
  if (text === null) return { ok: false, kind: 'invalid', status, error: 'The response is larger than 256 KB' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'invalid', status, error: 'The response is not JSON' }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.metrics)) {
    return { ok: false, kind: 'invalid', status, error: 'The response has no metrics list' }
  }
  // Unknown fields are ignored. An unknown major version is refused: the service may say which it spoke.
  if (typeof parsed.contract === 'string' && !parsed.contract.startsWith('astrid.metric-source/v1')) {
    return { ok: false, kind: 'invalid', status, error: `Unsupported contract ${parsed.contract.slice(0, 60)}` }
  }

  const asked = new Set(metrics.map(m => m.key))
  const seen = new Set<string>()
  const readings: MetricReading[] = []
  for (const raw of parsed.metrics) {
    const reading = parseReading(raw, asked, now())
    if (!reading || seen.has(reading.key)) continue
    seen.add(reading.key)
    readings.push(reading)
  }
  return { ok: true, readings }
}
