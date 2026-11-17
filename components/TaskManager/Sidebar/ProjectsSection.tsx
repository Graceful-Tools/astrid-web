"use client"

/**
 * The sidebar's projects (AWTD-1660), drawn only for people with Project Mode
 * (`useProjectMode`). Each project is its own section, headed by its name the
 * way Favorites and Lists are, its lists the section's own rows (ADEV-61; iOS
 * `SidebarProjectsSection`, ADEV-47/57). The header's name opens the project's
 * board, its chevron hides or shows the lists (remembered per browser), and a
 * right-click or long-press offers New List in Project… and, to the owner,
 * Delete Project…; a sidebar list dropped on the header moves into the project.
 * Which projects, which lists and in what order is astrid-core's contract (D70),
 * in lib/sidebar-projects.ts (ADEV-14); who may move or create where is the
 * core's `listProjectMoves` (lib/list-project-moves.ts).
 */
import React from "react"
import { ChevronRight, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { apiCall, refusalReason } from "@/lib/api"
import { removeLoadedProject, type ClientProject } from "@/lib/client-projects"
import { listProjectMoves, mayDeleteProject } from "@/lib/list-project-moves"
import { PROJECT_BOARD_LIST_DRAG_TYPE } from "@/lib/project-board-list-drag"
import { useTranslations } from "@/lib/i18n/client"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import { useSidebarProjectHidden } from "@/hooks/task-manager/useSidebarProjectHidden"
import { sidebarProjects } from "@/lib/sidebar-projects"
import type { TaskList } from "@/types/task"
import { ListItem } from "./ListItem"
import { ListProjectMenu } from "./ListProjectMenu"
import { SidebarConfirmDialog } from "./SidebarConfirmDialog"
import { SidebarContextMenu } from "./SidebarContextMenu"

interface ProjectsSectionProps {
  lists: TaskList[]
  isMobile: boolean
  selectedProjectId: string | null
  selectedListId: string
  onSelectProject: (projectId: string) => void
  onListClick: (listId: string) => void
  getTaskCountForList: (listId: string) => number
  /** Whose standing decides which projects offer "New list in project" (AWTD-1703). */
  currentUserId?: string
  onCreateListInProject?: (name: string, projectId: string) => Promise<void> | void
  /** Move a list into a project, or out of its project with null (ADEV-61). */
  onMoveListToProject?: (listId: string, projectId: string | null) => Promise<void> | void
  /** A project was deleted; its lists stay, outside any project (ADEV-61). */
  onProjectDeleted?: (projectId: string, detachedListIds: string[]) => void
}

export function ProjectsSection(props: ProjectsSectionProps) {
  const enabled = useProjectMode()
  const projects = useLoadedProjects()

  // The core's rule for where this person may create a list, not a guess from roles here.
  const creatableIn = React.useMemo(
    () => new Set(listProjectMoves(props.currentUserId ?? "", null, projects).creatableIn),
    [props.currentUserId, projects],
  )

  if (!enabled || projects.length === 0) return null

  const section = sidebarProjects(projects, props.lists) ?? []

  return (
    <div className="px-3" data-testid="sidebar-projects">
      {section.map(({ project, name, lists: projectLists }) => (
        <ProjectSection
          key={project.id}
          {...props}
          project={project}
          name={name}
          projectLists={projectLists}
          projects={projects}
          mayCreate={Boolean(props.onCreateListInProject) && creatableIn.has(project.id)}
        />
      ))}
    </div>
  )
}

interface ProjectSectionProps extends ProjectsSectionProps {
  project: ClientProject
  name: string
  projectLists: TaskList[]
  projects: ClientProject[]
  mayCreate: boolean
}

function ProjectSection({
  project,
  name,
  projectLists,
  projects,
  mayCreate,
  lists,
  isMobile,
  selectedProjectId,
  selectedListId,
  onSelectProject,
  onListClick,
  getTaskCountForList,
  currentUserId,
  onCreateListInProject,
  onMoveListToProject,
  onProjectDeleted,
}: ProjectSectionProps) {
  const { t } = useTranslations()
  const [hidden, toggleHidden] = useSidebarProjectHidden(project.id)
  const [creating, setCreating] = React.useState(false)
  const [newListName, setNewListName] = React.useState("")
  const [deleting, setDeleting] = React.useState(false)
  const [deleteBusy, setDeleteBusy] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [dropActive, setDropActive] = React.useState(false)

  const mayDelete = Boolean(currentUserId) && mayDeleteProject(currentUserId ?? "", project)
  const isSelected = selectedProjectId === project.id

  const startCreating = () => {
    setNewListName("")
    setCreating(true)
  }

  const submitNewList = async () => {
    const trimmed = newListName.trim()
    if (!trimmed || !onCreateListInProject) return
    setCreating(false)
    setNewListName("")
    await onCreateListInProject(trimmed, project.id)
  }

  const confirmDelete = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const response = await apiCall(`/api/v1/projects/${project.id}`, { method: "DELETE" })
      const payload = (await response.json().catch(() => null)) as { detachedListIds?: string[] } | null
      setDeleting(false)
      removeLoadedProject(project.id)
      onProjectDeleted?.(project.id, payload?.detachedListIds ?? projectLists.map(list => list.id))
    } catch (error) {
      setDeleteError(refusalReason(error) ?? t("projectMode.deleteProjectFailed"))
    } finally {
      setDeleteBusy(false)
    }
  }

  // A drop moves the list only where the core allows it; the drag cannot say which list
  // until the drop, so the header lights for any sidebar list and the drop decides.
  const isListDrag = (event: React.DragEvent) =>
    Boolean(onMoveListToProject) && Array.from(event.dataTransfer?.types ?? []).includes(PROJECT_BOARD_LIST_DRAG_TYPE)

  const handleDrop = (event: React.DragEvent) => {
    if (!isListDrag(event)) return
    event.preventDefault()
    setDropActive(false)
    const listId = event.dataTransfer.getData(PROJECT_BOARD_LIST_DRAG_TYPE)
    const dropped = lists.find(list => list.id === listId)
    if (!dropped || !onMoveListToProject) return
    if (listProjectMoves(currentUserId ?? "", dropped, projects).destinations.includes(project.id)) {
      void onMoveListToProject(listId, project.id)
    }
  }

  const menuItems = mayCreate || mayDelete ? (
    <>
      {mayCreate && (
        <DropdownMenuItem onSelect={startCreating}>
          <Plus aria-hidden="true" />
          {t("projectMode.newListInProject")}
        </DropdownMenuItem>
      )}
      {mayDelete && (
        <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setDeleting(true)}>
          <Trash2 aria-hidden="true" />
          {t("projectMode.deleteProject")}
        </DropdownMenuItem>
      )}
    </>
  ) : null

  return (
    <div data-testid={`sidebar-project-${project.id}`}>
      <SidebarContextMenu
        items={menuItems}
        data-testid={`sidebar-project-${project.id}-header`}
        className={`flex items-center gap-1 rounded-md pt-3 pb-1 pl-2 ${
          dropActive ? "ring-2 ring-brand bg-brand/15" : ""
        }`}
        onDragOver={event => {
          if (!isListDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        <button
          type="button"
          className={`min-w-0 flex-1 truncate text-left text-caption2 font-medium tracking-wide transition-opacity duration-fast ${
            isSelected ? "theme-text-primary" : "opacity-50 hover:opacity-80"
          }`}
          aria-current={isSelected ? "page" : undefined}
          aria-label={t("projectMode.openBoard", { name })}
          data-testid={`sidebar-project-${project.id}-open`}
          onClick={() => onSelectProject(project.id)}
        >
          {name}
        </button>
        {mayCreate && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 theme-text-muted hover:theme-text-primary"
            aria-label={t("projectMode.newListInProject")}
            title={t("projectMode.newListInProject")}
            data-testid={`sidebar-project-${project.id}-new-list`}
            onClick={() => (creating ? setCreating(false) : startCreating())}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 theme-text-muted hover:theme-text-primary"
          aria-expanded={!hidden}
          aria-label={t(hidden ? "projectMode.showLists" : "projectMode.hideLists", { name })}
          data-testid={`sidebar-project-${project.id}-toggle`}
          onClick={toggleHidden}
        >
          <ChevronRight className={`h-4 w-4 transition-transform duration-fast ${hidden ? "" : "rotate-90"}`} />
        </Button>
      </SidebarContextMenu>
      {creating && (
        <form
          className="mt-1"
          onSubmit={event => {
            event.preventDefault()
            void submitNewList()
          }}
        >
          <Input
            autoFocus
            value={newListName}
            onChange={event => setNewListName(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Escape") setCreating(false)
            }}
            placeholder={t("projectMode.newListName")}
            aria-label={t("projectMode.newListInProject")}
            data-testid={`sidebar-project-${project.id}-new-list-name`}
            className="h-8 text-sm"
          />
        </form>
      )}
      {!hidden && projectLists.length > 0 && (
        <div className="space-y-1" data-testid={`sidebar-project-${project.id}-lists`}>
          {projectLists.map(list => (
            <ListProjectMenu
              key={list.id}
              list={list}
              currentUserId={currentUserId}
              onMoveListToProject={onMoveListToProject}
            >
              <ListItem
                list={list}
                selectedListId={selectedProjectId ? "" : selectedListId}
                isMobile={isMobile}
                taskCount={getTaskCountForList(list.id)}
                onClick={onListClick}
                listDraggable
              />
            </ListProjectMenu>
          ))}
        </div>
      )}
      {mayDelete && (
        <SidebarConfirmDialog
          open={deleting}
          title={t("projectMode.deleteProjectConfirm", { name })}
          detail={t("projectMode.deleteProjectDetail")}
          confirmLabel={t("projectMode.deleteProjectAction")}
          busy={deleteBusy}
          error={deleteError}
          confirmTestId="sidebar-project-delete-confirm"
          onCancel={() => {
            setDeleting(false)
            setDeleteError(null)
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}
