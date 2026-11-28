"use client"

/**
 * Project settings (ADEV-54): "I cannot see a way to edit project settings."
 * The board header opens this for the owner or a project admin. It renames the
 * project (PATCH /api/v1/projects/:id { name }, ADEV-48) and states its goals
 * and guardrails (PUT /api/v1/projects/:id/goals, ADEV-179).
 */
import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiPatch } from "@/lib/api"
import { renameLoadedProject } from "@/lib/client-projects"
import { useTranslations } from "@/lib/i18n/client"
import { ProjectGoalsEditor, withoutDraftIds } from "@/components/projects/ProjectGoalsEditor"
import { ProjectConnectionsSection } from "@/components/projects/ProjectConnectionsSection"
import { useProjectGoals } from "@/hooks/use-project-goals"
import { DEFAULT_LIST_COLOR, LIST_COLOR_PALETTE } from "@/lib/brand/colors"
import { EMPTY_GOALS_AND_GUARDRAILS, type GoalsAndGuardrails } from "@/lib/goals-guardrails"

interface ProjectSettingsDialogProps {
  projectId: string
  projectName: string
  /** Offered with `projectColor` by the Settings Projects tab (ADEV-361); the board header leaves them out. */
  projectDescription?: string | null
  projectColor?: string | null
  /** The project as saved, so a list can follow an edit without a reload. */
  onSaved?: (changes: { name: string; description: string | null; color: string }) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectSettingsDialog({
  projectId,
  projectName,
  projectDescription,
  projectColor,
  onSaved,
  open,
  onOpenChange,
}: ProjectSettingsDialogProps) {
  const { t } = useTranslations()
  const detailsOffered = projectDescription !== undefined || projectColor !== undefined
  const storedDescription = projectDescription ?? ""
  const storedColor = projectColor ?? DEFAULT_LIST_COLOR
  const [name, setName] = React.useState(projectName)
  const [description, setDescription] = React.useState(storedDescription)
  const [color, setColor] = React.useState(storedColor)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [goalsFailed, setGoalsFailed] = React.useState(false)
  const { state: storedGoals, save: saveGoals } = useProjectGoals(open ? projectId : null)
  const [goals, setGoals] = React.useState<GoalsAndGuardrails>(EMPTY_GOALS_AND_GUARDRAILS)
  const [goalsTouched, setGoalsTouched] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(projectName)
      setDescription(storedDescription)
      setColor(storedColor)
      setFailed(false)
      setGoalsFailed(false)
      setGoalsTouched(false)
    }
  }, [open, projectName, storedDescription, storedColor])

  // Load what is stored into the editor, until the person starts editing it.
  React.useEffect(() => {
    if (open && storedGoals && !goalsTouched) setGoals({ goals: storedGoals.goals, guardrails: storedGoals.guardrails })
  }, [open, storedGoals, goalsTouched])

  const trimmed = name.trim()
  const trimmedDescription = description.trim()
  const descriptionChanged = detailsOffered && trimmedDescription !== storedDescription.trim()
  const colorChanged = detailsOffered && color.toLowerCase() !== storedColor.toLowerCase()
  const unchanged = trimmed === projectName && !descriptionChanged && !colorChanged && !goalsTouched

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!trimmed || saving) return
    if (unchanged) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setFailed(false)
    setGoalsFailed(false)
    let ok = true
    if (trimmed !== projectName || descriptionChanged || colorChanged) {
      try {
        await apiPatch(`/api/v1/projects/${projectId}`, {
          ...(trimmed !== projectName ? { name: trimmed } : {}),
          ...(descriptionChanged ? { description: trimmedDescription } : {}),
          ...(colorChanged ? { color } : {}),
        })
        if (trimmed !== projectName) renameLoadedProject(projectId, trimmed)
        onSaved?.({ name: trimmed, description: trimmedDescription || null, color })
      } catch {
        ok = false
        setFailed(true)
      }
    }
    if (goalsTouched) {
      try {
        // Blank rows are dropped by the server (lib/goals-guardrails.ts), so half-typed rows are harmless.
        await saveGoals(withoutDraftIds(goals) as GoalsAndGuardrails)
        setGoalsTouched(false)
      } catch {
        ok = false
        setGoalsFailed(true)
      }
    }
    setSaving(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-settings-dialog">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("projectMode.settingsTitle")}</DialogTitle>
          </DialogHeader>
          <label className="block space-y-1 text-sm theme-text-primary">
            <span>{t("projectMode.settingsNameLabel")}</span>
            <Input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              data-testid="project-settings-name"
            />
          </label>
          {detailsOffered && (
            <>
              <label className="block space-y-1 text-sm theme-text-primary">
                <span>{t("lists.listDescription")}</span>
                <Textarea
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  data-testid="project-settings-description"
                />
              </label>
              <div className="flex items-center justify-between text-sm theme-text-primary">
                <span>{t("listSettings.color.label")}</span>
                <div className="flex flex-wrap justify-end gap-1.5" role="radiogroup" aria-label={t("listSettings.color.label")}>
                  {LIST_COLOR_PALETTE.map(swatch => (
                    <button
                      key={swatch}
                      type="button"
                      role="radio"
                      aria-checked={color.toLowerCase() === swatch}
                      aria-label={swatch}
                      data-testid={`project-settings-color-${swatch}`}
                      onClick={() => setColor(swatch)}
                      className={`h-6 w-6 rounded-full ring-offset-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand ${color.toLowerCase() === swatch ? "ring-2 ring-brand" : ""}`}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="max-h-96 overflow-y-auto border-t theme-border pt-3">
            <h3 className="mb-2 text-sm font-semibold theme-text-primary">{t("projectMode.goals.title")}</h3>
            <ProjectGoalsEditor
              value={goals}
              onChange={next => {
                setGoals(next)
                setGoalsTouched(true)
              }}
            />
          </div>
          <div className="max-h-72 overflow-y-auto border-t theme-border pt-3 empty:hidden">
            <ProjectConnectionsSection projectId={projectId} />
          </div>
          {failed && (
            <p role="alert" className="text-xs text-danger">{t("projectMode.settingsSaveFailed")}</p>
          )}
          {goalsFailed && (
            <p role="alert" className="text-xs text-danger">{t("projectMode.goals.saveFailed")}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("projectMode.settingsCancel")}
            </Button>
            <Button type="submit" disabled={!trimmed || saving} data-testid="project-settings-save">
              {t("projectMode.settingsSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
