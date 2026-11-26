/**
 * The client's view of a task's experiment links, and the plain words the experiment row and the
 * Pending results card use for them (ADEV-282, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Surfaces).
 * Pure: the numbers and verdicts are the experiment service's, so nothing here computes a statistic.
 */
import type { ExperimentView } from '@/services/task-experiment.service'

export type { ExperimentView }

export interface TaskExperimentsState {
  experiments: ExperimentView[]
  /** The task is in the Pending results column, so the lane rules govern it. */
  inResultsColumn: boolean
}

/** A link still waiting on a result. */
export const isOpenLink = (link: Pick<ExperimentView, 'state'>) => link.state !== 'concluded' && link.state !== 'stopped'

/** `+4.2%` / `-1.0%` from a relative delta (0.042 → `+4.2%`). */
export function formatRelDelta(relDelta: number): string {
  const percent = relDelta * 100
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(1)}%`
}

/** How long ago, in the coarsest unit that is not zero: `3d`, `5h`, `12m`. */
export function ageLabel(from: string | Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(from).getTime())
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h`
  return `${Math.max(1, Math.floor(ms / 60_000))}m`
}

/** What a task in the column is waiting for, from its open links: the first open one, else null. */
export function waitingOn(experiments: readonly ExperimentView[]): ExperimentView | null {
  return experiments.find(isOpenLink) ?? null
}

/** The stale open link a card should say "no data since …" about, if any. */
export function staleLink(experiments: readonly ExperimentView[]): ExperimentView | null {
  return experiments.find(link => isOpenLink(link) && link.stale) ?? null
}

const DISMISS_PREFIX = 'astrid:results-column-offer-dismissed:'

/** Dismissal is remembered per board, in this browser. Storage that throws counts as "not dismissed". */
export function isOfferDismissed(boardId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISS_PREFIX + boardId) === '1'
  } catch {
    return false
  }
}

export function dismissOffer(boardId: string): void {
  try {
    globalThis.localStorage?.setItem(DISMISS_PREFIX + boardId, '1')
  } catch {
    // Not remembered; the offer may show again. Never worth an error.
  }
}
