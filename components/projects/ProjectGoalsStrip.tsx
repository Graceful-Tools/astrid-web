"use client"

/**
 * The project's goals and guardrails as a compact strip above the board (ADEV-179): the goal
 * statements with their measure line, then the guardrails. Nothing is drawn when the project
 * states none. Edited in the project settings dialog (ProjectGoalsEditor).
 */
import React from "react"
import { Lock, Target } from "lucide-react"
import { formatGoalMeasure, isEmptyGoals, type GoalsAndGuardrails } from "@/lib/goals-guardrails"
import { useTranslations } from "@/lib/i18n/client"

/** One labelled line of the strip: an icon and heading, then its entries. */
function StripRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-1 font-medium theme-text-primary">
        {icon}
        {label}
      </span>
      {children}
    </div>
  )
}

export function ProjectGoalsStrip({ goals }: { goals: GoalsAndGuardrails | null }) {
  const { t } = useTranslations()
  if (!goals || isEmptyGoals(goals)) return null

  return (
    <div className="space-y-1 border-b theme-border px-4 py-2 text-xs theme-text-secondary" data-testid="project-goals-strip">
      {goals.goals.length > 0 && (
        <StripRow icon={<Target className="h-3 w-3" aria-hidden="true" />} label={t("projectGoals.stripGoals")}>
          {goals.goals.map(goal => {
            const measure = formatGoalMeasure(goal)
            return (
              <span key={goal.id} data-testid="project-goal">
                {goal.statement}
                {measure && <span className="theme-text-muted"> ({measure})</span>}
              </span>
            )
          })}
        </StripRow>
      )}
      {goals.guardrails.length > 0 && (
        <StripRow icon={<Lock className="h-3 w-3" aria-hidden="true" />} label={t("projectGoals.stripGuardrails")}>
          {goals.guardrails.map(guardrail => (
            <span key={guardrail.id} data-testid="project-guardrail">
              {guardrail.statement}
              {guardrail.kind === "enforced" && (
                <span className="theme-text-muted"> · {t("projectGoals.enforcedBadge")}</span>
              )}
            </span>
          ))}
        </StripRow>
      )}
    </div>
  )
}
