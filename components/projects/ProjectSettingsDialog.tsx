"use client"

/**
 * Project settings (ADEV-54): "I cannot see a way to edit project settings."
 * The board header opens this for the owner or a project admin. Rename is the
 * one project setting the API takes today (PATCH /api/v1/projects/:id { name },
 * ADEV-48); the dialog is where the next ones belong.
 */
import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

interface ProjectSettingsDialogProps {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectSettingsDialog({ projectId, projectName, open, onOpenChange }: ProjectSettingsDialogProps) {
  const { t } = useTranslations()
  const [name, setName] = React.useState(projectName)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(projectName)
      setFailed(false)
    }
  }, [open, projectName])

  const trimmed = name.trim()
  const unchanged = trimmed === projectName

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!trimmed || saving) return
    if (unchanged) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setFailed(false)
    try {
      await apiPatch(`/api/v1/projects/${projectId}`, { name: trimmed })
      renameLoadedProject(projectId, trimmed)
      onOpenChange(false)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
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
          {failed && (
            <p role="alert" className="text-xs text-danger">{t("projectMode.settingsSaveFailed")}</p>
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
