"use client"

/**
 * Settings > Projects (ADEV-361, web half of ADEV-357): the person's projects, New Project, Edit
 * for an owner or project admin (name, description, colour, goals and guardrails) and Delete for
 * the owner. Shown only with Project Mode on; the create, edit and delete calls are the ones the
 * sidebar and the board header already make.
 */
import React from "react"
import { useSession } from "next-auth/react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ProjectSettingsDialog } from "@/components/projects/ProjectSettingsDialog"
import { apiCall, apiPost, refusalReason } from "@/lib/api"
import { DEFAULT_LIST_COLOR } from "@/lib/brand/colors"
import {
  addLoadedProject,
  removeLoadedProject,
  updateLoadedProject,
  type ClientProject,
} from "@/lib/client-projects"
import { mayAdministerProject, mayDeleteProject } from "@/lib/list-project-moves"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"

interface ProjectsSettingsProps {
  onNavigate: (page: string) => void
}

export default function ProjectsSettings(_props: ProjectsSettingsProps) {
  const { t } = useTranslations()
  const { data: session } = useSession()
  const projectMode = useProjectMode()
  const projects = useLoadedProjects()
  const userId = session?.user?.id ?? ""

  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [createBusy, setCreateBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<ClientProject | null>(null)
  const [deleting, setDeleting] = React.useState<ClientProject | null>(null)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  if (!projectMode) return null

  const projectName = (project: ClientProject) => project.name || project.key || project.id

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name || createBusy) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const response = await apiPost("/api/v1/projects", { name })
      const { project } = await response.json()
      if (project) addLoadedProject(project)
      setCreating(false)
      setNewName("")
    } catch (error) {
      setCreateError(refusalReason(error) ?? t("projectMode.createBoardFailed"))
    } finally {
      setCreateBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await apiCall(`/api/v1/projects/${deleting.id}`, { method: "DELETE" })
      removeLoadedProject(deleting.id)
      setDeleting(null)
    } catch (error) {
      setDeleteError(refusalReason(error) ?? t("projectMode.deleteProjectFailed"))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-2 sm:p-4" data-testid="projects-settings">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold theme-text-primary">{t("projectMode.projectsHeading")}</h1>
        <Button size="sm" data-testid="projects-settings-new" onClick={() => setCreating(open => !open)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t("projectMode.projectNew")}
        </Button>
      </div>
      {creating && (
        <form onSubmit={create} className="flex items-center gap-2" data-testid="projects-settings-create-form">
          <Input
            autoFocus
            value={newName}
            onChange={event => setNewName(event.target.value)}
            aria-label={t("projectMode.settingsNameLabel")}
            data-testid="projects-settings-new-name"
          />
          <Button type="submit" disabled={!newName.trim() || createBusy} data-testid="projects-settings-create">
            {t("projectMode.settingsSave")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setCreating(false)}>
            {t("projectMode.settingsCancel")}
          </Button>
        </form>
      )}
      {createError && (
        <p role="alert" className="text-xs text-danger">{createError}</p>
      )}
      <ul className="space-y-2">
        {projects.map(project => {
          const mayEdit = mayAdministerProject(userId, project)
          const mayDelete = mayDeleteProject(userId, project)
          return (
            <li
              key={project.id}
              data-testid={`projects-settings-row-${project.id}`}
              className="flex items-center gap-3 rounded-lg border theme-border theme-bg-secondary p-3"
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: project.color ?? DEFAULT_LIST_COLOR }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium theme-text-primary">{projectName(project)}</div>
                {project.description && (
                  <div className="truncate text-sm theme-text-muted">{project.description}</div>
                )}
              </div>
              {mayEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("projectMode.boardSettings")}
                  title={t("projectMode.boardSettings")}
                  data-testid={`projects-settings-edit-${project.id}`}
                  onClick={() => setEditing(project)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              {mayDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-danger"
                  aria-label={t("projectMode.deleteProject")}
                  title={t("projectMode.deleteProject")}
                  data-testid={`projects-settings-delete-${project.id}`}
                  onClick={() => setDeleting(project)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <ProjectSettingsDialog
          projectId={editing.id}
          projectName={projectName(editing)}
          projectDescription={editing.description ?? ""}
          projectColor={editing.color ?? DEFAULT_LIST_COLOR}
          open
          onSaved={changes => updateLoadedProject(editing.id, changes)}
          onOpenChange={open => {
            if (!open) setEditing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={t("projectMode.deleteProjectConfirm", { name: deleting ? projectName(deleting) : "" })}
        detail={t("projectMode.deleteProjectDetail")}
        confirmLabel={t("projectMode.deleteProjectAction")}
        busy={deleteBusy}
        error={deleteError}
        confirmTestId="projects-settings-delete-confirm"
        onCancel={() => {
          setDeleting(null)
          setDeleteError(null)
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  )
}
