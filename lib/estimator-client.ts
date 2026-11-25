/**
 * The client for `astrid.estimator/v1` (ADEV-278, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → The three
 * contracts). Astrid calls the service: signed with `generateWebhookHeaders`, a bearer credential from
 * the environment when the service names one, 10 s timeout, 256 KB response. A reply is either 200
 * with the result, or 202 `{ estimateId, pollAfterSeconds }` and then `GET {base}/estimates/{id}`,
 * which the caller polls through the Job queue (`estimator-poll`).
 *
 * The result is returned raw. Nothing here trusts it: `sanitizeEstimate` does that.
 */
import { generateWebhookHeaders } from '@/lib/webhook-signature'
import { assertPublicOutboundUrl } from '@/lib/security/outbound-url'
import { ESTIMATOR_CONTRACT } from '@/lib/task-estimate'
import type { SignalService } from '@/lib/goal-signal-services'

export const ESTIMATOR_TIMEOUT_MS = 10_000
export const ESTIMATOR_MAX_RESPONSE_BYTES = 256 * 1024

export interface EstimatorRequest {
  requestId: string
  idea: { id: string; title: string; description: string }
  goals: Array<Record<string, unknown>>
  guardrails: Array<Record<string, unknown>>
  environment?: Record<string, unknown>
  want: string[]
}

export type EstimatorReply =
  | { kind: 'result'; result: unknown }
  | { kind: 'pending'; estimateId: string; pollAfterSeconds: number }

/** `retryable` errors (5xx, 429, timeouts) back off through the queue; the rest are recorded and stop. */
export class EstimatorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'EstimatorError'
  }
}

const POLL_MIN_SECONDS = 2
const POLL_MAX_SECONDS = 300

async function readLimitedJson(res: Response): Promise<unknown> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > ESTIMATOR_MAX_RESPONSE_BYTES) {
    throw new EstimatorError('Estimator response too large', false)
  }
  const text = await res.text()
  if (Buffer.byteLength(text, 'utf8') > ESTIMATOR_MAX_RESPONSE_BYTES) {
    throw new EstimatorError('Estimator response too large', false)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new EstimatorError('Estimator returned invalid JSON', false)
  }
}

function credentialFor(service: SignalService): string | undefined {
  // The variable's name is configuration; its value is read here and nowhere else.
  const value = process.env[service.secretEnv]
  return value?.trim() || undefined
}

async function send(service: SignalService, url: string, method: 'GET' | 'POST', body?: string): Promise<Response> {
  const target = await assertPublicOutboundUrl(url)
  const secret = credentialFor(service)
  const headers: Record<string, string> = secret
    ? generateWebhookHeaders(body ?? '', secret, 'estimator.request')
    : { 'Content-Type': 'application/json' }
  if (secret) headers.Authorization = `Bearer ${secret}`
  try {
    return await fetch(target, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(ESTIMATOR_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error)?.name
    throw new EstimatorError(
      name === 'TimeoutError' || name === 'AbortError' ? 'Estimator timed out' : 'Estimator unreachable',
      true,
    )
  }
}

function failOnStatus(res: Response): void {
  if (res.ok) return
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new EstimatorError(
      'Estimator is rate limiting',
      true,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : undefined,
    )
  }
  throw new EstimatorError(`Estimator answered ${res.status}`, res.status >= 500)
}

function baseOf(service: SignalService): string {
  return service.baseUrl.replace(/\/+$/, '')
}

async function interpret(res: Response): Promise<EstimatorReply> {
  failOnStatus(res)
  const body = await readLimitedJson(res)
  if (res.status === 202) {
    const accepted = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    if (typeof accepted.estimateId !== 'string' || !accepted.estimateId.trim()) {
      throw new EstimatorError('Estimator accepted the request without an estimateId', false)
    }
    const pollAfter = typeof accepted.pollAfterSeconds === 'number' ? accepted.pollAfterSeconds : 30
    return {
      kind: 'pending',
      estimateId: accepted.estimateId,
      pollAfterSeconds: Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, pollAfter)),
    }
  }
  return { kind: 'result', result: body }
}

/** POST {base}/estimates */
export async function requestEstimate(service: SignalService, request: EstimatorRequest): Promise<EstimatorReply> {
  const payload = JSON.stringify({ contract: ESTIMATOR_CONTRACT, ...request })
  return interpret(await send(service, `${baseOf(service)}/estimates`, 'POST', payload))
}

/** GET {base}/estimates/{id}. A 202 answer means it is still running. */
export async function pollEstimate(service: SignalService, estimateId: string): Promise<EstimatorReply> {
  return interpret(await send(service, `${baseOf(service)}/estimates/${encodeURIComponent(estimateId)}`, 'GET'))
}
