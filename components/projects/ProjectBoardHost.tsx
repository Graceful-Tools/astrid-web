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
import { peekLoadedProjects } from "@/lib/client-projects"
import type { Task, TaskList, User } from "@/types/task"

interface ProjectBoardHostProps {
  lists: TaskList[]
  tasks: Task[]
  currentUser?: User | null
  onUpdateTask: (task: Task) => void
  onDeleteTask: (taskId: string) => void
  onCreateTask: ProjectBoardProps["onCreateTask"]
}

export function ProjectBoardHost({ lists, tasks, currentUser, onUpdateTask, onDeleteTask, onCreateTask }: ProjectBoardHostProps) {
  const projectId = useSelectedProjectId()
  const enabled = useProjectMode()
  const projects = useLoadedProjects()
  const project = projectId && enabled ? projects.find(candidate => candidate.id === projectId) : undefined

  React.useEffect(() => {
    if (projectId && !project && peekLoadedProjects() !== null) setSelectedProjectId(null)
  }, [projectId, project, projects])

  if (!project) return null
  return (
    <ProjectBoard
      key={project.id}
      projectId={project.id}
      projectName={project.name || project.key || ""}
      lists={lists}
      allTasks={tasks}
      currentUser={currentUser}
      onUpdateTask={onUpdateTask}
      onDeleteTask={onDeleteTask}
      onCreateTask={onCreateTask}
    />
  )
}
