"use client"

/**
 * The goals a task or a list serves, as chips (ADEV-276, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md
 * → Surfaces). Chips link and unlink over `/api/v1/tasks/:id/goals` and `/api/v1/lists/:id/goal-links`.
 * A task also shows the goals its lists serve, read-only (`via: "list"`): unlink those on the list.
 *
 * Nothing is drawn while loading, when a read fails, or when the project states no goals.
 */
import React from "react"
import { Plus, Target, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiDelete, apiGet, apiPut } from "@/lib/api"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectGoals } from "@/hooks/use-project-goals"

interface GoalLinkRow {
  goalId: string
  via: "task" | "list"
}

interface GoalChipsProps {
  kind: "task" | "list"
  id: string
  /** The project whose goals are offered. Tasks on lists in no project pass nothing and get nothing. */
  projectId: string | null | undefined
  /** Linking needs write access to the task, or admin on the list. */
  canEdit: boolean
}

const linksUrl = (kind: "task" | "list", id: string) =>
  kind === "task" ? `/api/v1/tasks/${encodeURIComponent(id)}/goals` : `/api/v1/lists/${encodeURIComponent(id)}/goal-links`

export function GoalChips({ kind, id, projectId, canEdit }: GoalChipsProps) {
  const { t } = useTranslations()
  const { state } = useProjectGoals(projectId)
  const [links, setLinks] = React.useState<GoalLinkRow[] | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!projectId) return
    let active = true
    setLinks(null)
    apiGet(linksUrl(kind, id))
      .then(response => response.json())
      .then((body: { links?: Array<GoalLinkRow & { projectId?: string }> }) => {
        if (!active) return
        setLinks((body.links ?? []).filter(link => !link.projectId || link.projectId === projectId))
      })
      .catch(() => { if (active) setLinks(null) })
    return () => { active = false }
  }, [kind, id, projectId])

  if (!projectId || !state || state.goals.length === 0 || links === null) return null

  const own = links.filter(link => link.via === "task" || kind === "list").map(link => link.goalId)
  const inherited = links.filter(link => link.via === "list" && kind === "task").map(link => link.goalId)
  const statementOf = (goalId: string) => state.goals.find(goal => goal.id === goalId)?.statement
  const unlinked = state.goals.filter(goal => !own.includes(goal.id) && !inherited.includes(goal.id))

  /** Replace the own links; the routes answer with the whole set, so one write is the new truth. */
  const write = async (goalIds: string[]) => {
    setFailed(false)
    try {
      const response = await apiPut(linksUrl(kind, id), { goalIds, ...(kind === "task" ? { projectId } : {}) })
      const body = (await response.json()) as { links?: Array<GoalLinkRow & { projectId?: string }> }
      setLinks((body.links ?? []).filter(link => !link.projectId || link.projectId === projectId))
    } catch {
      setFailed(true)
    }
  }

  const unlink = async (goalId: string) => {
    setFailed(false)
    try {
      await apiDelete(linksUrl(kind, id), { body: JSON.stringify({ goalId, ...(kind === "task" ? { projectId } : {}) }) })
      setLinks(current => (current ?? []).filter(link => !(link.goalId === goalId && (link.via === "task" || kind === "list"))))
    } catch {
      setFailed(true)
    }
  }

  if (!own.length && !inherited.length && !canEdit) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="goal-chips">
      <Target className="h-4 w-4 theme-text-muted" aria-hidden="true" />
      {own.map(goalId => (
        <Badge key={goalId} variant="secondary" className="gap-1" data-testid="goal-chip">
          <span>{statementOf(goalId) ?? goalId}</span>
          {canEdit && (
            <button
              type="button"
              aria-label={t("projectMode.goals.unlinkGoal", { goal: statementOf(goalId) ?? goalId })}
              data-testid="goal-chip-unlink"
              onClick={() => unlink(goalId)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </Badge>
      ))}
      {inherited.map(goalId => (
        <Badge key={`via-${goalId}`} variant="outline" title={t("projectMode.goals.viaList")} data-testid="goal-chip-inherited">
          {statementOf(goalId) ?? goalId}
        </Badge>
      ))}
      {canEdit && unlinked.length > 0 && (
        <Select value="" onValueChange={goalId => write([...own, goalId])}>
          <SelectTrigger
            className="h-6 w-auto gap-1 px-2 text-xs"
            aria-label={t("projectMode.goals.linkGoal")}
            data-testid="goal-chip-add"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            <SelectValue placeholder={t("projectMode.goals.linkGoal")} />
          </SelectTrigger>
          <SelectContent>
            {unlinked.map(goal => (
              <SelectItem key={goal.id} value={goal.id}>
                {goal.statement}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {failed && (
        <span role="alert" className="text-xs text-danger">
          {t("projectMode.goals.linkFailed")}
        </span>
      )}
    </div>
  )
}
