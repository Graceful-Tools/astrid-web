"use client"

/**
 * Edit a project's goals and guardrails (ADEV-179), inside the project settings dialog. The owner
 * or an admin states what the project is trying to achieve (with an optional measure, target and
 * current reading) and what it must not do. Saved as one value on Save; the server validates it
 * (lib/goals-guardrails.ts) and a refusal is shown as it came.
 */
import React from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/client"
import {
  GUARDRAIL_KINDS,
  type Goal,
  type GoalsAndGuardrails,
  type Guardrail,
  type GuardrailKind,
} from "@/lib/goals-guardrails"

export interface ProjectGoalsEditorProps {
  value: GoalsAndGuardrails | null
  onSave: (next: GoalsAndGuardrails | null) => Promise<{ ok: true } | { ok: false; error: string | null }>
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function ProjectGoalsEditor({ value, onSave }: ProjectGoalsEditorProps) {
  const { t } = useTranslations()
  const [goals, setGoals] = React.useState<Goal[]>(value?.goals ?? [])
  const [guardrails, setGuardrails] = React.useState<Guardrail[]>(value?.guardrails ?? [])
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // What the server holds changes when the dialog's read lands or after a save: follow it.
  React.useEffect(() => {
    setGoals(value?.goals ?? [])
    setGuardrails(value?.guardrails ?? [])
  }, [value])

  const patchGoal = (id: string, patch: Partial<Goal>) =>
    setGoals(current => current.map(goal => (goal.id === id ? { ...goal, ...patch } : goal)))
  const patchGuardrail = (id: string, patch: Partial<Guardrail>) =>
    setGuardrails(current => current.map(guardrail => (guardrail.id === id ? { ...guardrail, ...patch } : guardrail)))

  const save = async () => {
    setSaving(true)
    setError(null)
    // A row left blank is not a statement; drop it rather than refuse the whole save.
    const result = await onSave({
      goals: goals.filter(goal => goal.statement.trim()),
      guardrails: guardrails.filter(guardrail => guardrail.statement.trim()),
    })
    setSaving(false)
    if (!result.ok) setError(result.error ?? t("projectGoals.saveFailed"))
  }

  return (
    <section className="space-y-3" data-testid="project-goals-editor">
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium theme-text-primary">{t("projectGoals.title")}</h3>
        <p className="text-xs theme-text-muted">{t("projectGoals.help")}</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium theme-text-secondary">{t("projectGoals.goalsHeading")}</h4>
        {goals.map(goal => (
          <div key={goal.id} className="space-y-1" data-testid="project-goal-row">
            <div className="flex items-center gap-2">
              <Input
                value={goal.statement}
                placeholder={t("projectGoals.goalPlaceholder")}
                onChange={event => patchGoal(goal.id, { statement: event.target.value })}
                data-testid="project-goal-statement"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("projectGoals.remove")}
                onClick={() => setGoals(current => current.filter(item => item.id !== goal.id))}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["measure", "target", "current"] as const).map(field => (
                <Input
                  key={field}
                  value={goal[field] ?? ""}
                  placeholder={t(`projectGoals.${field}`)}
                  aria-label={t(`projectGoals.${field}`)}
                  onChange={event => patchGoal(goal.id, { [field]: event.target.value })}
                  data-testid={`project-goal-${field}`}
                />
              ))}
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="project-goal-add"
          onClick={() => setGoals(current => [...current, { id: newId(), statement: "" }])}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectGoals.addGoal")}
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium theme-text-secondary">{t("projectGoals.guardrailsHeading")}</h4>
        {guardrails.map(guardrail => (
          <div key={guardrail.id} className="flex items-center gap-2" data-testid="project-guardrail-row">
            <Input
              value={guardrail.statement}
              placeholder={t("projectGoals.guardrailPlaceholder")}
              onChange={event => patchGuardrail(guardrail.id, { statement: event.target.value })}
              data-testid="project-guardrail-statement"
            />
            <Select
              value={guardrail.kind}
              onValueChange={kind => patchGuardrail(guardrail.id, { kind: kind as GuardrailKind })}
            >
              <SelectTrigger className="w-44 shrink-0" aria-label={t("projectGoals.kind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-above-modal">
                {GUARDRAIL_KINDS.map(kind => (
                  <SelectItem key={kind} value={kind}>
                    {t(kind === "stated" ? "projectGoals.kindStated" : "projectGoals.kindEnforced")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("projectGoals.remove")}
              onClick={() => setGuardrails(current => current.filter(item => item.id !== guardrail.id))}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="project-guardrail-add"
          onClick={() => setGuardrails(current => [...current, { id: newId(), statement: "", kind: "stated" }])}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectGoals.addGuardrail")}
        </Button>
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <Button type="button" size="sm" disabled={saving} onClick={save} data-testid="project-goals-save">
        {t("projectMode.settingsSave")}
      </Button>
    </section>
  )
}
