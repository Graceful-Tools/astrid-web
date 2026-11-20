"use client"

/**
 * The open project board (AWTD-1660), mounted by the task view in place of the
 * list whenever a project is selected.
 *
 * Loaded lazily with the board (components/TaskManager/lazy-panels.tsx): the
 * task view itself only knows the selected project id (hooks/use-selected-project),
 * so the gating below costs the first load nothing. When the person does not
 * have Project Mode, or the project is not one of theirs, it closes the
 * selection once the projects have loaded and the list view comes back.
 */
import React from "react"
import { ProjectBoard, type ProjectBoardProps } from "@/components/projects/ProjectBoard"
import { setSelectedProjectId, useSelectedProjectId } from "@/hooks/use-selected-project"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import { listProjectMoves, mayAdministerProject } from "@/lib/list-project-moves"
import { peekLoadedProjects } from "@/lib/client-projects"
import type { Task, TaskList, User } from "@/types/task"

interface ProjectBoardHostProps {
  lists: TaskList[]
  tasks: Task[]
  currentUser?: User | null
  onUpdateTask: (task: Task) => void
  onCreateTask: ProjectBoardProps["onCreateTask"]
  onOpenTask?: ProjectBoardProps["onOpenTask"]
  onCreateListInProject?: ProjectBoardProps["onCreateListInProject"]
  selectedTaskId?: string | null
  isOneColumn?: boolean
  /** The view's Sort & Filters state; the board applies its `filters` to every row (ADEV-156). */
  filterState?: { filters: Omit<NonNullable<ProjectBoardProps["liveFilters"]>, "dueDate"> & { dueDate: string } }
}

export function ProjectBoardHost({ lists, tasks, currentUser, onUpdateTask, onCreateTask, onOpenTask, onCreateListInProject, selectedTaskId, isOneColumn, filterState }: ProjectBoardHostProps) {
  const projectId = useSelectedProjectId()
  const enabled = useProjectMode()
  const projects = useLoadedProjects()
  const project = projectId && enabled ? projects.find(candidate => candidate.id === projectId) : undefined

  React.useEffect(() => {
    if (projectId && !project && peekLoadedProjects() !== null) setSelectedProjectId(null)
  }, [projectId, project, projects])

  if (!project) return null
  // The core's rule for where this person may create a list, as the sidebar uses.
  const mayCreateList = listProjectMoves(currentUser?.id ?? "", null, projects).creatableIn.includes(project.id)
  return (
    <ProjectBoard
      key={project.id}
      projectId={project.id}
      projectName={project.name || project.key || ""}
      canEditSettings={mayAdministerProject(currentUser?.id ?? "", project)}
      lists={lists}
      allTasks={tasks}
      currentUser={currentUser}
      onUpdateTask={onUpdateTask}
      onCreateTask={onCreateTask}
      onOpenTask={onOpenTask}
      onCreateListInProject={mayCreateList ? onCreateListInProject : undefined}
      selectedTaskId={selectedTaskId}
      isOneColumn={isOneColumn}
      // The saved due-date window is validated where the filter state is built (savedDueDateFilter).
      liveFilters={filterState?.filters as ProjectBoardProps["liveFilters"]}
    />
  )
}
