/**
 * The client for `astrid.experiment-source/v1` (ADEV-279, docs/specs/GOALS_GUARDRAILS_SIGNALS.md →
 * The three contracts → Experiment source). Server-only.
 *
 * Astrid calls the service: `POST {base}/experiments/status`, signed with `generateWebhookHeaders`
 * and an optional bearer credential, the same envelope as the metric source (lib/goal-signals-metric-source.ts,
 * whose limits and error taxonomy it shares): 10 s, 256 KB, no redirects, a URL a person typed passes
 * the outbound guard on every call. The request carries the project's goals and guardrails, so the
 * service can recommend against them.
 *
 * **Astrid computes no statistics.** The reply is read by `sanitizeExperimentReply`
 * (lib/task-experiment.ts): the service's deltas, intervals, significance, verdict and recommendation
 * are kept as the service gave them, clipped, and never recomputed.
 *
 * Never throws. The result says what to do next: `client` (a 4xx, not retried), `retry` (429 with
 * `retryAfterSeconds`, 5xx, timeout), `invalid` (a 2xx that is not the contract).
 */
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { assertPublicOutboundUrl } from '@/lib/security/outbound-url'
import {
  METRIC_SOURCE_MAX_BYTES,
  METRIC_SOURCE_TIMEOUT_MS,
  parseRetryAfter,
  type MetricSourceTarget,
} from '@/lib/goal-signals-metric-source'
import { EXPERIMENT_SOURCE_CONTRACT, sanitizeExperimentReply, type ExperimentReading } from '@/lib/task-experiment'
import type { GoalsAndGuardrails } from '@/lib/goals-guardrails'

export const EXPERIMENT_SOURCE_EVENT = 'experiments.status'

export type ExperimentStatusResult =
  | { ok: true; reading: ExperimentReading }
  | { ok: false; kind: 'client' | 'retry' | 'invalid'; error: string; status?: number; retryAfterSeconds?: number }

export interface ExperimentStatusOptions {
  fetchImpl?: typeof fetch
  now?: () => Date
  requestId?: string
}

/** The goals and guardrails as the contract's request carries them: typed metrics only. */
export function contractGoalsAndGuardrails(stated: GoalsAndGuardrails) {
  const goals = stated.goals.flatMap(goal => {
    const metric = goal.metric
    if (!metric?.source) return []
    return [{
      id: goal.id,
      metricKey: metric.source.metricKey,
      direction: metric.direction,
      ...(typeof metric.target === 'number' ? { target: metric.target } : {}),
    }]
  })
  const guardrails = stated.guardrails.flatMap(rail => {
    const check = rail.check
    if (rail.kind !== 'enforced' || check?.type !== 'metric') return []
    return [{ id: rail.id, metricKey: check.source.metricKey, op: check.op, threshold: check.threshold }]
  })
  return { goals, guardrails }
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

/** Ask the service where one experiment stands. */
export async function fetchExperimentStatus(
  target: MetricSourceTarget,
  key: string,
  stated: GoalsAndGuardrails,
  options: ExperimentStatusOptions = {},
): Promise<ExperimentStatusResult> {
  const now = options.now ?? (() => new Date())
  const doFetch = options.fetchImpl ?? fetch
  const endpoint = `${target.baseUrl.replace(/\/+$/, '')}/experiments/status`

  try {
    if (target.userSuppliedUrl) await assertPublicOutboundUrl(endpoint)
  } catch (error) {
    return { ok: false, kind: 'client', error: error instanceof Error ? error.message : 'URL is not allowed' }
  }

  const body = JSON.stringify({
    contract: EXPERIMENT_SOURCE_CONTRACT,
    requestId: options.requestId ?? crypto.randomUUID(),
    experiments: [{ key }],
    ...contractGoalsAndGuardrails(stated),
  })
  const headers: Record<string, string> = target.credential
    ? { ...generateWebhookHeaders(body, target.credential, EXPERIMENT_SOURCE_EVENT), Authorization: `Bearer ${target.credential}` }
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
  if (status >= 300 && status < 400) return { ok: false, kind: 'client', status, error: `The service answered ${status}; redirects are not followed` }
  if (status >= 400) return { ok: false, kind: 'client', status, error: `The service refused the request (${status})` }

  const text = await readCapped(response).catch(() => null)
  if (text === null) return { ok: false, kind: 'invalid', status, error: 'The response is larger than 256 KB' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'invalid', status, error: 'The response is not JSON' }
  }
  if (parsed && typeof parsed === 'object' && typeof (parsed as { contract?: unknown }).contract === 'string') {
    const spoke = (parsed as { contract: string }).contract
    if (!spoke.startsWith('astrid.experiment-source/v1')) {
      return { ok: false, kind: 'invalid', status, error: `Unsupported contract ${spoke.slice(0, 60)}` }
    }
  }
  const reading = sanitizeExperimentReply(parsed, key, now())
  if (!reading) return { ok: false, kind: 'invalid', status, error: 'The service did not report that experiment' }
  return { ok: true, reading }
}
