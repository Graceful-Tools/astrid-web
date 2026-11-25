"use client"

/**
 * A project's goals and guardrails on its board (ADEV-179), for everyone working there: a compact
 * toggle in the board header that opens the full statement. Nothing is drawn while loading, when
 * the read fails, or when the project states nothing — the board looks as it did.
 */
import React from "react"
import { ChevronDown, ChevronRight, Target } from "lucide-react"
import { useLocale, useTranslations } from "@/lib/i18n/client"
import { formatRelativeFromNow } from "@/lib/i18n/date-format"
import { useProjectGoals } from "@/hooks/use-project-goals"
import { GoalSparkline } from "@/components/projects/GoalSparkline"
import {
  goalFreshness,
  goalProgress,
  goalSparkValues,
  hasGoalsOrGuardrails,
  type ProjectGoal,
} from "@/lib/goals-guardrails"

/** Where a goal's number comes from, how fresh it is, and how it moved (ADEV-276). Nothing for a prose goal. */
function GoalSignal({ goal }: { goal: ProjectGoal }) {
  const { t } = useTranslations()
  const locale = useLocale()
  const source = goal.metric?.source
  const freshness = goalFreshness(goal)
  const values = goalSparkValues(goal)
  if (!source && !freshness && values.length < 2) return null
  const age = freshness ? formatRelativeFromNow(-freshness.ageMs, locale) : null
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-xs theme-text-secondary" data-testid="project-goal-signal">
      {source && (
        <span data-testid="project-goal-source">
          {t("projectMode.goals.sourceName", { source: `${source.connectorId} · ${source.metricKey}` })}
        </span>
      )}
      {freshness && (
        <span
          className={freshness.stale ? "text-danger" : undefined}
          data-testid="project-goal-freshness"
          data-stale={freshness.stale ? "true" : "false"}
        >
          {freshness.stale
            ? t("projectMode.goals.staleSince", { age: age! })
            : t("projectMode.goals.updatedAgo", { age: age! })}
        </span>
      )}
      <GoalSparkline values={values} label={t("projectMode.goals.sparklineLabel", { goal: goal.measure ?? goal.statement })} />
    </span>
  )
}

export function ProjectGoalsStrip({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const { state } = useProjectGoals(projectId)
  const [open, setOpen] = React.useState(false)
  if (!state || !hasGoalsOrGuardrails(state)) return null

  /** Progress toward the target when both read as numbers (ADEV-182); nothing for a prose measure. */
  const progressText = (goal: ProjectGoal) => {
    const progress = goalProgress(goal)
    if (!progress) return null
    if (progress.met) return t("projectMode.goals.targetMet")
    return progress.percent === null ? null : t("projectMode.goals.progressValue", { percent: String(progress.percent) })
  }

  return (
    <div className="mr-auto min-w-0 text-sm theme-text-primary" data-testid="project-goals-strip">
      <button
        type="button"
        className="flex items-center gap-1 rounded-md px-2 py-1 theme-text-secondary hover:theme-bg-hover"
        aria-expanded={open}
        title={t("projectMode.goals.title")}
        data-testid="project-goals-toggle"
        onClick={() => setOpen(value => !value)}
      >
        {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
        <Target className="h-4 w-4" aria-hidden="true" />
        <span>
          {t("projectMode.goals.counts", { goals: String(state.goals.length), guardrails: String(state.guardrails.length) })}
        </span>
      </button>
      {open && (
        <div className="mt-2 grid gap-4 px-2 pb-2 sm:grid-cols-2" data-testid="project-goals-detail">
          {state.goals.length > 0 && (
            <section>
              <h3 className="mb-1 font-medium">{t("projectMode.goals.goalsHeading")}</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {state.goals.map(goal => (
                  <li key={goal.id}>
                    <span>{goal.statement}</span>
                    {(goal.measure || goal.target || goal.current || state.workByGoal[goal.id]) && (
                      <span className="block text-xs theme-text-secondary" data-testid="project-goal-measure">
                        {[
                          goal.measure,
                          goal.target && t("projectMode.goals.targetValue", { value: goal.target }),
                          goal.current && t("projectMode.goals.currentValue", { value: goal.current }),
                          progressText(goal),
                          state.workByGoal[goal.id] && t("projectMode.goals.workServed", { count: String(state.workByGoal[goal.id]) }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    <GoalSignal goal={goal} />
                  </li>
                ))}
              </ol>
            </section>
          )}
          {state.guardrails.length > 0 && (
            <section>
              <h3 className="mb-1 font-medium">{t("projectMode.goals.guardrailsHeading")}</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {state.guardrails.map(rail => (
                  <li key={rail.id}>
                    {rail.statement}
                    {rail.kind === "enforced" && (
                      <span className="ml-2 text-xs theme-text-secondary">{t("projectMode.goals.kindEnforced")}</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
