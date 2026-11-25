/**
 * The environment's registry of goal-signal services (ADEV-269,
 * docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Gating). Server-only.
 *
 * `ASTRID_SIGNAL_SERVICES` is JSON `[{ key, kind, name, baseUrl, secretEnv }]`.
 * `secretEnv` names the variable that holds the credential; the credential
 * itself is never read here and never published. A malformed registry offers
 * nothing rather than throwing: a bad variable must not take down
 * /api/v1/capabilities.
 */

import { CAPABILITIES, explicitlyEnabled } from '@/lib/brand/capabilities'

export const SIGNAL_SERVICE_KINDS = ['metric', 'experiment', 'estimator'] as const
export type SignalServiceKind = typeof SIGNAL_SERVICE_KINDS[number]

export interface SignalService {
  key: string
  kind: SignalServiceKind
  name: string
  baseUrl: string
  secretEnv: string
}

/** What a client may be told about a service: never the URL or the secret's name. */
export interface SignalServiceSummary {
  key: string
  name: string
}

export interface GoalSignalsOffering {
  metricSources: SignalServiceSummary[]
  experimentSources: SignalServiceSummary[]
  estimators: SignalServiceSummary[]
  customEndpoints: boolean
}

const BUILTIN_ESTIMATOR_KEY = 'builtin'

/** The services the environment defines. Invalid entries are dropped, duplicate keys keep the first. */
export function parseSignalServices(raw: string | undefined): SignalService[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>([BUILTIN_ESTIMATOR_KEY])
  const services: SignalService[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const { key, kind, name, baseUrl, secretEnv } = item as Record<string, unknown>
    if (typeof key !== 'string' || !key.trim() || seen.has(key)) continue
    if (!SIGNAL_SERVICE_KINDS.includes(kind as SignalServiceKind)) continue
    if (typeof name !== 'string' || !name.trim()) continue
    if (typeof baseUrl !== 'string' || !/^https:\/\//i.test(baseUrl.trim())) continue
    if (typeof secretEnv !== 'string' || !secretEnv.trim()) continue
    seen.add(key)
    services.push({
      key,
      kind: kind as SignalServiceKind,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      secretEnv: secretEnv.trim(),
    })
  }
  return services
}

/** The built-in estimator is on unless explicitly turned off. */
export function builtinEstimatorEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return true
  return !['false', '0', 'off', 'no'].includes(normalized)
}

/** The server-only variables, read literally so scripts/check-env-schema.ts sees each one. */
function signalEnv(): Record<string, string | undefined> {
  return {
    ASTRID_SIGNAL_SERVICES: process.env.ASTRID_SIGNAL_SERVICES,
    ASTRID_SIGNALS_BUILTIN_ESTIMATOR: process.env.ASTRID_SIGNALS_BUILTIN_ESTIMATOR,
    ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS: process.env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS,
  }
}

/** The environment's services of one kind. Empty when the capability is off. */
export function signalServicesOfKind(
  kind: SignalServiceKind,
  env: Record<string, string | undefined> = signalEnv(),
): SignalService[] {
  if (!CAPABILITIES.goalSignals) return []
  return parseSignalServices(env.ASTRID_SIGNAL_SERVICES).filter(s => s.kind === kind)
}

export const BUILTIN_ESTIMATOR = BUILTIN_ESTIMATOR_KEY

const summary = (s: SignalService): SignalServiceSummary => ({ key: s.key, name: s.name })

/** What `/api/v1/capabilities` publishes as `goalSignals`. Nothing when the capability is off. */
export function goalSignalsOffering(env: Record<string, string | undefined> = signalEnv()): GoalSignalsOffering {
  if (!CAPABILITIES.goalSignals) {
    return { metricSources: [], experimentSources: [], estimators: [], customEndpoints: false }
  }
  const services = parseSignalServices(env.ASTRID_SIGNAL_SERVICES)
  const estimators = services.filter(s => s.kind === 'estimator').map(summary)
  return {
    metricSources: services.filter(s => s.kind === 'metric').map(summary),
    experimentSources: services.filter(s => s.kind === 'experiment').map(summary),
    estimators: builtinEstimatorEnabled(env.ASTRID_SIGNALS_BUILTIN_ESTIMATOR)
      ? [{ key: BUILTIN_ESTIMATOR_KEY, name: 'Built-in estimator' }, ...estimators]
      : estimators,
    customEndpoints: explicitlyEnabled(env.ASTRID_SIGNALS_ALLOW_CUSTOM_ENDPOINTS),
  }
}
