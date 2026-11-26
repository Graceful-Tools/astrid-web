/**
 * The poll job that reads goal metrics from outside sources (ADEV-277). Server-only.
 *
 * Built on the template of lib/sync/github/sync-all-links.ts: orchestration lives here so the cron
 * route is auth plus a call, a pass is BOUNDED, and the STALEST connector goes first, so a pass cut
 * short leaves the rest at the front of the next one instead of starving the same tail every time.
 * ONE CONNECTOR'S FAILURE MUST NOT STOP THE REST: a revoked key or a dead service costs that
 * connector its turn, never anyone else's.
 *
 * What a pass does per connector: find the goals and metric guardrails bound to it, ask the service
 * once for every key they name, and write each fresh reading through `recordGoalMeasurement`
 * (source `pull`) and `recordGuardrailReading`. A reading already past its `staleAfterHours` is not
 * written: the value shown simply ages into "unknown", as the spec says every rule must read it.
 * Nothing here ever writes a guess: no_data and unknown_metric record nothing.
 */

import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { canUseGoalSignals } from '@/lib/goal-signals'
import { isReadingFresh, storedGoalsAndGuardrails, type GoalsAndGuardrails } from '@/lib/goals-guardrails'
import { queryMetricSource, type MetricQueryResult, type MetricReading } from '@/lib/goal-signals-metric-source'
import { recordGoalMeasurement, recordGuardrailReading } from '@/services/project-goals.service'
import { connectorFailureText, metricTargetFor, recordConnectorOutcome, retryNotBefore } from '@/services/project-connectors.service'

const log = createLogger('goal-signals.poll')

/** How many connectors one pass will call: the cron has a 60 s budget and each call can take 10. */
export const MAX_CONNECTORS_PER_PASS = 20
/** The most keys one request carries. */
export const MAX_KEYS_PER_REQUEST = 50

export interface PollSummary {
  connectors: number
  capped: boolean
  remaining: number
  recorded: number
  guardrailsUpdated: number
  skipped: number
  failed: number
}

/** The keys of the enforced metric guardrails bound to a connector. */
function boundGuardrailKeys(stated: GoalsAndGuardrails, connectorId: string): string[] {
  const keys = new Set<string>()
  for (const rail of stated.guardrails) {
    const check = rail.check
    if (rail.kind === 'enforced' && check?.type === 'metric' && check.source.connectorId === connectorId) keys.add(check.source.metricKey)
  }
  return [...keys]
}

/** The metric keys a connector is asked for, from the goals and guardrails bound to it. */
export function boundKeys(stated: GoalsAndGuardrails, connectorId: string): string[] {
  const keys = new Set<string>(boundGuardrailKeys(stated, connectorId))
  for (const goal of stated.goals) {
    if (goal.metric?.source?.connectorId === connectorId) keys.add(goal.metric.source.metricKey)
  }
  return [...keys].slice(0, MAX_KEYS_PER_REQUEST)
}

/**
 * One pass. `projectId` narrows it to one project's connectors: a verification reaching its
 * `decideBy` reads the project's sources fresh first (ADEV-279), rather than comparing against
 * whatever the last 15-minute pass left.
 */
export async function pollGoalMetrics(options: { fetchImpl?: typeof fetch; now?: () => Date; projectId?: string } = {}): Promise<PollSummary> {
  const now = options.now ?? (() => new Date())
  const where = { kind: 'metric', ...(options.projectId ? { projectId: options.projectId } : {}) }
  const connectors = await prisma.projectConnector.findMany({
    where,
    orderBy: { lastPolledAt: { sort: 'asc', nulls: 'first' } },
    take: MAX_CONNECTORS_PER_PASS,
  })
  const total = await prisma.projectConnector.count({ where })
  const summary: PollSummary = {
    connectors: connectors.length,
    capped: total > connectors.length,
    remaining: Math.max(0, total - connectors.length),
    recorded: 0,
    guardrailsUpdated: 0,
    skipped: 0,
    failed: 0,
  }

  for (const connector of connectors) {
    try {
      const wait = retryNotBefore(connector.config)
      if (wait && wait.getTime() > now().getTime()) {
        summary.skipped++
        continue
      }
      const project = await prisma.project.findUnique({ where: { id: connector.projectId }, select: { id: true, ownerId: true, goalsAndGuardrails: true } })
      // A project that lost the feature, or a connector nothing is bound to, costs no request.
      if (!project || !(await canUseGoalSignals(project.ownerId))) {
        summary.skipped++
        await touch(connector.id, now())
        continue
      }
      const stated = storedGoalsAndGuardrails(project.goalsAndGuardrails)
      const keys = boundKeys(stated, connector.id)
      if (!keys.length) {
        summary.skipped++
        await touch(connector.id, now())
        continue
      }

      const built = metricTargetFor(connector)
      const result: MetricQueryResult = built.target
        ? await queryMetricSource(built.target, keys.map(key => ({ key })), { fetchImpl: options.fetchImpl, now })
        : { ok: false, kind: 'client', error: built.error }
      await recordConnectorOutcome(connector.id, result, now())
      if (!result.ok) {
        summary.failed++
        log.warn({ connectorId: connector.id, kind: result.kind, status: result.status }, 'Metric source call failed')
        continue
      }

      const byKey = new Map(result.readings.map(r => [r.key, r]))
      for (const goal of stated.goals) {
        const source = goal.metric?.source
        if (!source || source.connectorId !== connector.id) continue
        const reading = byKey.get(source.metricKey)
        if (!reading || !usable(reading, goal.metric?.staleAfterHours, goal.metric?.measuredAt, now())) continue
        const written = await recordGoalMeasurement(
          project.id,
          project.ownerId,
          goal.id,
          { value: reading.value, ...(goal.metric?.unit || !reading.unit ? {} : { unit: reading.unit }), at: reading.at, externalId: `${connector.id}:${source.metricKey}:${reading.at}` },
          connector.id,
          'pull',
        )
        if (written.ok) summary.recorded++
      }
      for (const key of boundGuardrailKeys(stated, connector.id)) {
        const reading = byKey.get(key)
        if (!reading || reading.status !== 'ok' || !isReadingFresh(reading.at, undefined, now())) continue
        summary.guardrailsUpdated += await recordGuardrailReading(
          project.id,
          { connectorId: connector.id, metricKey: key },
          { value: reading.value!, at: new Date(reading.at!) },
        )
      }
      const unknown = result.readings.filter(r => r.status === 'unknown_metric').map(r => r.key)
      if (unknown.length) {
        await prisma.projectConnector.update({ where: { id: connector.id }, data: { lastError: connectorFailureText(`The service does not know: ${unknown.join(', ')}`) } })
      }
    } catch (error) {
      summary.failed++
      log.error({ err: error, connectorId: connector.id }, 'Metric poll failed for connector')
      await touch(connector.id, now()).catch(() => undefined)
    }
  }
  return summary
}

/** A reading worth writing: a number, newer than what is stored, and not already past its freshness window. */
function usable(reading: MetricReading, staleAfterHours: number | undefined, storedAt: string | undefined, now: Date): boolean {
  if (reading.status !== 'ok' || reading.value === undefined || !reading.at) return false
  if (!isReadingFresh(reading.at, staleAfterHours, now)) return false
  const stored = storedAt ? Date.parse(storedAt) : NaN
  return Number.isNaN(stored) || stored <= Date.parse(reading.at)
}

/** Count a pass as this connector's turn, so one with nothing to do does not hold the front of the queue. */
function touch(connectorId: string, at: Date) {
  return prisma.projectConnector.update({ where: { id: connectorId }, data: { lastPolledAt: at } })
}
