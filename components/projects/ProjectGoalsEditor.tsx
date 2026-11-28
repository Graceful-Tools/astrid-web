"use client"

/**
 * Editing a project's goals and guardrails (ADEV-179), inside project settings. A controlled list
 * editor: the dialog owns the value and saves it with PUT /api/v1/projects/:id/goals.
 */
import React from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/client"
import {
  FIELD_MAX_CHARS,
  GOALS_MAX,
  GUARDRAILS_MAX,
  STATEMENT_MAX_CHARS,
  type GoalMetric,
  type GoalsAndGuardrails,
  type GuardrailKind,
  type ProjectGoal,
  type ProjectGuardrail,
} from "@/lib/goals-guardrails"

interface ProjectGoalsEditorProps {
  value: GoalsAndGuardrails
  onChange: (value: GoalsAndGuardrails) => void
}

/** React keys for rows added here. Dropped before saving, so the server assigns g1, r1… */
let draftCounter = 0
const DRAFT = "-draft-"
const draftId = (prefix: string) => `${prefix}${DRAFT}${++draftCounter}`

/** The value to send: rows added in this editor lose their draft key and get a server id. */
export function withoutDraftIds(value: GoalsAndGuardrails): unknown {
  const strip = <T extends { id: string }>(item: T) => (item.id.includes(DRAFT) ? { ...item, id: undefined } : item)
  return { goals: value.goals.map(strip), guardrails: value.guardrails.map(strip) }
}

/** A number field's text as a number: empty clears it, anything unreadable leaves it as it was. */
function numberPatch(raw: string): number | undefined | null {
  if (raw.trim() === "") return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function ProjectGoalsEditor({ value, onChange }: ProjectGoalsEditorProps) {
  const { t } = useTranslations()

  const setGoal = (index: number, patch: Partial<ProjectGoal>) =>
    onChange({ ...value, goals: value.goals.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)) })
  /** Edit the metric block; keys the server writes (current, measuredAt) and the source ride along untouched. */
  const setMetric = (index: number, patch: Partial<GoalMetric>) => {
    const metric = value.goals[index].metric
    if (!metric) return
    setGoal(index, { metric: { ...metric, ...patch } })
  }
  const setMetricNumber = (index: number, key: "target" | "baseline" | "staleAfterHours", raw: string) => {
    const n = numberPatch(raw)
    if (n !== null) setMetric(index, { [key]: n })
  }
  const setGuardrail = (index: number, patch: Partial<ProjectGuardrail>) =>
    onChange({ ...value, guardrails: value.guardrails.map((rail, i) => (i === index ? { ...rail, ...patch } : rail)) })

  return (
    <div className="space-y-4 text-sm theme-text-primary" data-testid="project-goals-editor">
      <p className="text-xs theme-text-secondary">{t("projectMode.goals.intro")}</p>

      <fieldset className="space-y-2">
        <legend className="font-medium">{t("projectMode.goals.goalsHeading")}</legend>
        <p className="text-xs theme-text-secondary">{t("projectMode.goals.fieldsHint")}</p>
        {value.goals.map((goal, index) => (
          <div key={goal.id} className="space-y-1 rounded-md border theme-border p-2" data-testid="project-goal-row">
            <div className="flex items-center gap-2">
              <Input
                value={goal.statement}
                maxLength={STATEMENT_MAX_CHARS}
                placeholder={t("projectMode.goals.goalPlaceholder")}
                aria-label={t("projectMode.goals.goalPlaceholder")}
                onChange={event => setGoal(index, { statement: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("projectMode.goals.remove")}
                title={t("projectMode.goals.remove")}
                onClick={() => onChange({ ...value, goals: value.goals.filter((_, i) => i !== index) })}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["measure", "target", "current"] as const).map(field => (
                <div key={field} className="space-y-1">
                  <label htmlFor={`${goal.id}-${field}`} className="text-xs theme-text-secondary">
                    {t(`projectMode.goals.${field}Label`)}
                  </label>
                  <Input
                    id={`${goal.id}-${field}`}
                    value={goal[field] ?? ""}
                    maxLength={FIELD_MAX_CHARS}
                    placeholder={t(`projectMode.goals.${field}Placeholder`)}
                    onChange={event => setGoal(index, { [field]: event.target.value })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <label htmlFor={`${goal.id}-targetDate`} className="text-xs theme-text-secondary">
                  {t("projectMode.goals.targetDateLabel")}
                </label>
                <Input
                  id={`${goal.id}-targetDate`}
                  type="date"
                  value={goal.targetDate ?? ""}
                  data-testid="project-goal-target-date"
                  onChange={event => setGoal(index, { targetDate: event.target.value || undefined })}
                />
              </div>
            </div>
            {goal.metric ? (
              <div className="space-y-1" data-testid="project-goal-metric">
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={goal.metric.unit ?? ""}
                    maxLength={FIELD_MAX_CHARS}
                    placeholder={t("projectMode.goals.unitPlaceholder")}
                    aria-label={t("projectMode.goals.unitPlaceholder")}
                    onChange={event => setMetric(index, { unit: event.target.value || undefined })}
                  />
                  <Select
                    value={goal.metric.direction}
                    onValueChange={direction => setMetric(index, { direction: direction as GoalMetric["direction"] })}
                  >
                    <SelectTrigger aria-label={t("projectMode.goals.directionLabel")} data-testid="project-goal-direction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="up">{t("projectMode.goals.directionUp")}</SelectItem>
                      <SelectItem value="down">{t("projectMode.goals.directionDown")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="project-goal-remove-metric"
                    onClick={() => setGoal(index, { metric: null })}
                  >
                    {t("projectMode.goals.removeMetric")}
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["target", "baseline", "staleAfterHours"] as const).map(key => (
                    <Input
                      key={key}
                      type="number"
                      inputMode="decimal"
                      value={goal.metric?.[key] ?? ""}
                      placeholder={t(`projectMode.goals.metric_${key}`)}
                      aria-label={t(`projectMode.goals.metric_${key}`)}
                      data-testid={`project-goal-metric-${key}`}
                      onChange={event => setMetricNumber(index, key, event.target.value)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="project-goal-add-metric"
                onClick={() => setGoal(index, { metric: { direction: "up" } })}
              >
                {t("projectMode.goals.addMetric")}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.goals.length >= GOALS_MAX}
          data-testid="project-goals-add-goal"
          onClick={() => onChange({ ...value, goals: [...value.goals, { id: draftId("g"), statement: "" }] })}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectMode.goals.addGoal")}
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">{t("projectMode.goals.guardrailsHeading")}</legend>
        {value.guardrails.map((rail, index) => (
          <div key={rail.id} className="flex items-center gap-2" data-testid="project-guardrail-row">
            <Input
              value={rail.statement}
              maxLength={STATEMENT_MAX_CHARS}
              placeholder={t("projectMode.goals.guardrailPlaceholder")}
              aria-label={t("projectMode.goals.guardrailPlaceholder")}
              onChange={event => setGuardrail(index, { statement: event.target.value })}
            />
            <Select value={rail.kind} onValueChange={kind => setGuardrail(index, { kind: kind as GuardrailKind })}>
              <SelectTrigger className="w-32 shrink-0" aria-label={t("projectMode.goals.kindLabel")} title={t("projectMode.goals.kindHint")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stated">{t("projectMode.goals.kindStated")}</SelectItem>
                <SelectItem value="enforced">{t("projectMode.goals.kindEnforced")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("projectMode.goals.remove")}
              title={t("projectMode.goals.remove")}
              onClick={() => onChange({ ...value, guardrails: value.guardrails.filter((_, i) => i !== index) })}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={value.guardrails.length >= GUARDRAILS_MAX}
          data-testid="project-goals-add-guardrail"
          onClick={() =>
            onChange({ ...value, guardrails: [...value.guardrails, { id: draftId("r"), statement: "", kind: "stated" }] })
          }
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectMode.goals.addGuardrail")}
        </Button>
      </fieldset>
    </div>
  )
}
