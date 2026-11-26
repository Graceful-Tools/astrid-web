"use client"

/**
 * The experiment row in task details (ADEV-282, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md → Surfaces):
 * for each experiment or verification the task is linked to, its state, verdict, per-metric deltas, the
 * service's recommendation, a link out and Refresh. It works on any board, with or without the Pending
 * results column. Draws nothing without goal signals, on a task whose lists are in no project, or
 * while the read is loading or refused. Every number and verdict is the experiment service's.
 */
import React from "react"
import { FlaskConical, RefreshCw, X } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { Button } from "@/components/ui/button"
import { ExperimentLinkForm } from "@/components/projects/ExperimentLinkForm"
import { ResultsColumnOffer } from "@/components/projects/ResultsColumnOffer"
import { fillMessage } from "@/components/shared/RichMessage"
import { useGoalSignals } from "@/hooks/use-goal-signals"
import { useTaskExperiments } from "@/hooks/use-task-experiments"
import { useTranslations } from "@/lib/i18n/client"
import { ageLabel, formatRelDelta, isOpenLink, type ExperimentView } from "@/lib/task-experiment-client"
import type { Task } from "@/types/task"

function ExperimentItem({ link, canEdit, onUnlink }: { link: ExperimentView; canEdit: boolean; onUnlink: (id: string) => void }) {
  const { t } = useTranslations()
  const title =
    link.kind === "verification"
      ? t("projectMode.experiment.verification")
      : link.externalKey ?? t("projectMode.experiment.experiment")
  const metrics = link.metrics.filter(metric => typeof metric.relDelta === "number")
  const stale = isOpenLink(link) && link.stale
  return (
    <li className="space-y-0.5 text-xs" data-testid={`experiment-item-${link.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{title}</span>
        <span className="theme-text-muted" data-testid="experiment-state">{t(`projectMode.experiment.state.${link.state}`)}</span>
        {link.verdict && <span data-testid="experiment-verdict">{t(`projectMode.experiment.verdict.${link.verdict}`)}</span>}
        {link.url && (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline" data-testid="experiment-link-out">
            {t("projectMode.experiment.open")}
          </a>
        )}
        {canEdit && (
          <button
            type="button"
            className="theme-text-muted hover:text-foreground"
            aria-label={t("projectMode.experiment.remove")}
            onClick={() => onUnlink(link.id)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
      {metrics.length > 0 && (
        <ul className="theme-text-muted" data-testid="experiment-metrics">
          {metrics.map(metric => (
            <li key={metric.metricKey}>
              {metric.metricKey} {formatRelDelta(metric.relDelta as number)}
              {metric.significant === false ? ` (${t("projectMode.experiment.notSignificant")})` : ""}
            </li>
          ))}
        </ul>
      )}
      {link.recommendation && (
        <p data-testid="experiment-recommendation">
          {fillMessage(t("projectMode.experiment.recommends"), { action: t(`projectMode.experiment.action.${link.recommendation.action}`) })}
          {link.recommendation.reason ? `: ${link.recommendation.reason}` : ""}
        </p>
      )}
      {link.decideBy && isOpenLink(link) && (
        <p className="theme-text-muted">
          {fillMessage(t("projectMode.experiment.decideBy"), { date: new Date(link.decideBy).toLocaleDateString() })}
        </p>
      )}
      {stale && (
        <p className="text-warning" data-testid="experiment-stale">
          {link.fetchedAt
            ? fillMessage(t("projectMode.experiment.noDataSince"), { age: ageLabel(link.fetchedAt) })
            : t("projectMode.experiment.noDataYet")}
        </p>
      )}
    </li>
  )
}

export function TaskDetailExperimentRow({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const { t } = useTranslations()
  const goalSignals = useGoalSignals()
  const project = task.lists?.find(list => list.projectId)
  const projectId = project?.projectId
  const { state, refresh, unlink } = useTaskExperiments(task.id, goalSignals && Boolean(projectId))
  const [adding, setAdding] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  if (!goalSignals || !projectId || !task.id || !state) return null
  const hasOpen = state.experiments.some(isOpenLink)

  const doRefresh = async () => {
    setRefreshing(true)
    setFailed(false)
    try {
      await refresh()
    } catch {
      setFailed(true)
    } finally {
      setRefreshing(false)
    }
  }

  // Nothing to say, and nobody who can change that: no row.
  if (!state.experiments.length && readOnly) return null

  return (
    <TaskFieldRow label={t("projectMode.experiment.title")} icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />} align="start">
      <div className="min-w-0 flex-1 space-y-1.5" data-testid="task-experiment-row">
        {state.experiments.length > 0 ? (
          <ul className="space-y-2">
            {state.experiments.map(link => (
              <ExperimentItem key={link.id} link={link} canEdit={!readOnly} onUnlink={id => void unlink(id)} />
            ))}
          </ul>
        ) : (
          <p className="text-xs theme-text-muted">{t("projectMode.experiment.none")}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {hasOpen && (
            <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={doRefresh} data-testid="experiment-refresh">
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
              {refreshing ? t("projectMode.experiment.refreshing") : t("projectMode.experiment.refresh")}
            </Button>
          )}
          {!readOnly && !adding && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="experiment-add">
              {t("projectMode.experiment.addButton")}
            </Button>
          )}
        </div>
        {failed && <p role="alert" className="text-xs text-danger">{t("projectMode.experiment.refreshFailed")}</p>}
        {adding && !readOnly && (
          <ExperimentLinkForm taskId={task.id} projectId={projectId} onLinked={() => setAdding(false)} onCancel={() => setAdding(false)} />
        )}
        {state.experiments.length > 0 && !readOnly && <ResultsColumnOffer projectId={projectId} />}
      </div>
    </TaskFieldRow>
  )
}
