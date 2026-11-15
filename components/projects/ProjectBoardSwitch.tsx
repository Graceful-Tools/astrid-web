"use client"

/**
 * Draws the open project board in place of the list view (AWTD-1660), or the
 * list view (`children`) when no board is open, the person does not have
 * Project Mode, the project is not one of theirs, or search has the surface.
 *
 * Its own component so the task view only wraps its list surface in it, and
 * the board itself stays a lazy chunk.
 */
import React from "react"
import { LazyProjectBoard } from "@/components/TaskManager/lazy-panels"
import { useSelectedProjectId } from "@/hooks/use-selected-project"
import { useProjectMode } from "@/hooks/use-project-mode"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import type { ClientProject } from "@/lib/client-projects"
import type { Task, TaskList, User } from "@/types/task"

interface ProjectBoardSwitchProps {
  lists: TaskList[]
  tasks: Task[]
  currentUser?: User | null
  suppressed?: boolean
  onUpdateTask: (task: Task) => void
  onDeleteTask: (taskId: string) => void
  children: React.ReactNode
}

/**
 * The project whose board is open, or undefined: one is selected, the person
 * has Project Mode, and it is one of their projects. The task view also asks,
 * to lay the page out as a board (fixed-width messages pane).
 */
export function useOpenProject(): ClientProject | undefined {
  const projectId = useSelectedProjectId()
  const enabled = useProjectMode()
  const projects = useLoadedProjects()
  if (!projectId || !enabled) return undefined
  return projects.find(candidate => candidate.id === projectId)
}

export function ProjectBoardSwitch({ lists, tasks, currentUser, suppressed, onUpdateTask, onDeleteTask, children }: ProjectBoardSwitchProps) {
  const project = useOpenProject()

  if (suppressed || !project) return <>{children}</>
  return (
    <LazyProjectBoard
      key={project.id}
      projectId={project.id}
      projectName={project.name || project.key || ""}
      lists={lists}
      allTasks={tasks}
      currentUser={currentUser}
      onUpdateTask={onUpdateTask}
      onDeleteTask={onDeleteTask}
    />
  )
}
