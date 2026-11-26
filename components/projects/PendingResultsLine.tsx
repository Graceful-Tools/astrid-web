"use client"

/**
 * What a card in the Pending results column waits for, and "no data since …" when its source is stale
 * (ADEV-282, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 7, rule P4). Drawn under the title of a
 * card whose `statusRole` is `results`; nothing otherwise, and nothing without goal signals. It reads
 * the task's links once per card, from the cache the experiment row shares.
 */
import { Hourglass } from "lucide-react"
import { fillMessage } from "@/components/shared/RichMessage"
import { useGoalSignals } from "@/hooks/use-goal-signals"
import { useTaskExperiments } from "@/hooks/use-task-experiments"
import { RESULTS_STATUS_ROLE } from "@/lib/board-presets"
import { useTranslations } from "@/lib/i18n/client"
import { ageLabel, staleLink, waitingOn } from "@/lib/task-experiment-client"

export function PendingResultsLine({ taskId, statusRole }: { taskId: string; statusRole?: string | null }) {
  const { t } = useTranslations()
  const goalSignals = useGoalSignals()
  const inColumn = statusRole === RESULTS_STATUS_ROLE
  const { state } = useTaskExperiments(taskId, goalSignals && inColumn)
  if (!goalSignals || !inColumn || !state) return null

  const waiting = waitingOn(state.experiments)
  if (!waiting) return null
  const stale = staleLink(state.experiments)

  const what =
    waiting.kind === "verification"
      ? fillMessage(t("projectMode.experiment.waitingVerification"), {
          date: waiting.decideBy ? new Date(waiting.decideBy).toLocaleDateString() : "",
        })
      : fillMessage(t("projectMode.experiment.waitingFor"), { name: waiting.externalKey ?? t("projectMode.experiment.experiment") })

  return (
    <div className="mt-1 space-y-0.5 text-xs theme-text-muted" data-testid="pending-results-line">
      <p className="flex items-center gap-1">
        <Hourglass className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <span>{what}</span>
      </p>
      {stale && (
        <p className="text-warning" data-testid="pending-results-stale">
          {stale.fetchedAt
            ? fillMessage(t("projectMode.experiment.noDataSince"), { age: ageLabel(stale.fetchedAt) })
            : t("projectMode.experiment.noDataYet")}
        </p>
      )}
    </div>
  )
}
