"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { KanbanSquare } from "lucide-react"
import type { TaskList } from "@/types/task"
import { useProjects, getProjectPrimaryListId } from "@/hooks/use-projects"
import { useProjectsBeta } from "@/hooks/useProjectsBeta"

interface BoardViewSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
  onProjectBoardCreated?: (projectLists: TaskList[]) => void
  onProjectBoardRemoved?: (projectId: string, detachedListIds: string[]) => void
}

/**
 * Project Status Board controls for a list's admin settings: the
 * "Create Board" / "Disable Board" toggle and the disable-confirmation
 * modal. Extracted from list-admin-settings.tsx (Stage 13 of the
 * god-file refactor) — owns its own state and the two server mutations.
 */
export function BoardViewSection({
  list,
  canEditSettings,
  onUpdate,
  onProjectBoardCreated,
  onProjectBoardRemoved,
}: BoardViewSectionProps) {
  const [isCreatingProjectBoard, setIsCreatingProjectBoard] = useState(false)
  const [isRemovingProjectBoard, setIsRemovingProjectBoard] = useState(false)
  const [projectBoardError, setProjectBoardError] = useState<string | null>(null)
  const [showDisableBoardConfirmation, setShowDisableBoardConfirmation] = useState(false)
  const [attachTargetId, setAttachTargetId] = useState<string>("")
  const [isAttaching, setIsAttaching] = useState(false)

  // Projects the list could be attached to (board sub-task #2). Only fetched
  // when this is an unattached, editable list.
  const { projects } = useProjects(canEditSettings && !list.projectId)
  // Only offer projects that are real boards (have a domain list), mirroring
  // the sidebar filter. This hides empty/orphan projects — e.g. ones left
  // behind when an earlier board-creation attached its list but the project
  // itself was never populated — which otherwise show up as same-named dupes.
  const attachableProjects = projects.filter(
    (project) => getProjectPrimaryListId(project) !== null,
  )
  // Projects is an opt-in Beta. Hide the create/attach affordance unless the
  // user has enabled it — but keep showing controls for a list that is ALREADY
  // a board so existing boards remain manageable.
  const { enabled: projectsBetaEnabled } = useProjectsBeta()

  const handleAttachToProject = useCallback(async () => {
    if (!attachTargetId || list.projectId || isAttaching) return
    setIsAttaching(true)
    setProjectBoardError(null)
    try {
      const response = await fetch(`/api/projects/${attachTargetId}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: list.id }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to attach list')
      }
      const data = await response.json()
      const updatedList: TaskList = data.list ?? { ...list, projectId: attachTargetId }
      onUpdate(updatedList)
      onProjectBoardCreated?.([updatedList])
      setAttachTargetId("")
    } catch (error) {
      console.error('Error attaching list to project:', error)
      setProjectBoardError(error instanceof Error ? error.message : 'Failed to attach list')
    } finally {
      setIsAttaching(false)
    }
  }, [attachTargetId, isAttaching, list, onProjectBoardCreated, onUpdate])

  const handleCreateProjectBoard = useCallback(async () => {
    if (list.projectId || isCreatingProjectBoard) return

    setIsCreatingProjectBoard(true)
    setProjectBoardError(null)

    try {
      const projectResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: list.name,
          description: list.description || null,
          color: list.color || '#3b82f6',
          imageUrl: list.imageUrl || null,
        }),
      })

      if (!projectResponse.ok) {
        throw new Error(await projectResponse.text())
      }

      const project = await projectResponse.json()
      const listResponse = await fetch(`/api/lists/${list.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...list,
          projectId: project.id,
          listType: 'regular',
        }),
      })

      if (!listResponse.ok) {
        // The project was created but the list didn't attach. Roll the project
        // back so it can't linger as an empty, same-named orphan (which is how
        // duplicate projects accumulated). Best-effort — ignore cleanup errors.
        await fetch(`/api/projects/${project.id}`, { method: 'DELETE' }).catch(() => {})
        throw new Error(await listResponse.text())
      }

      const updatedList = await listResponse.json()
      onUpdate(updatedList)

      if (project.lists?.length) {
        onProjectBoardCreated?.([updatedList, ...project.lists])
      } else {
        onProjectBoardCreated?.([updatedList])
      }
    } catch (error) {
      console.error('Error creating project status board:', error)
      setProjectBoardError(error instanceof Error ? error.message : 'Failed to create board')
    } finally {
      setIsCreatingProjectBoard(false)
    }
  }, [isCreatingProjectBoard, list, onProjectBoardCreated, onUpdate])

  const handleRemoveProjectBoard = useCallback(async () => {
    if (!list.projectId || isRemovingProjectBoard) return

    setIsRemovingProjectBoard(true)
    setProjectBoardError(null)

    const projectId = list.projectId

    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await response.text())
      }
      const payload = (await response.json().catch(() => null)) as
        | { detachedListIds?: string[] }
        | null

      onUpdate({ ...list, projectId: null })
      onProjectBoardRemoved?.(projectId, payload?.detachedListIds || [list.id])
      setShowDisableBoardConfirmation(false)
    } catch (error) {
      console.error('Error removing project status board:', error)
      setProjectBoardError(error instanceof Error ? error.message : 'Failed to disable board')
    } finally {
      setIsRemovingProjectBoard(false)
    }
  }, [isRemovingProjectBoard, list, onProjectBoardRemoved, onUpdate])

  if (!canEditSettings) return null
  // Beta off and not already a board → hide the section entirely.
  if (!projectsBetaEnabled && !list.projectId) return null

  return (
    <>
      <div className="space-y-2 rounded-md border theme-border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label className="text-sm theme-text-secondary flex items-center space-x-1.5">
              <KanbanSquare className="w-4 h-4" />
              <span>Board View</span>
            </Label>
            <p className="mt-1 text-xs theme-text-muted">
              {list.projectId
                ? "This list has a Ready / Doing / Waiting status board. Inbox holds new tasks; Done is completed."
                : "Add Ready, Doing, and Waiting status columns. Inbox and Done are derived automatically."}
            </p>
          </div>
          {list.projectId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isRemovingProjectBoard}
              onClick={() => setShowDisableBoardConfirmation(true)}
              className="shrink-0"
            >
              <KanbanSquare className="w-4 h-4 mr-1" />
              {isRemovingProjectBoard ? "Disabling..." : "Disable Board"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={isCreatingProjectBoard}
              onClick={handleCreateProjectBoard}
              className="shrink-0"
            >
              <KanbanSquare className="w-4 h-4 mr-1" />
              {isCreatingProjectBoard ? "Creating..." : "Create Board"}
            </Button>
          )}
        </div>
        {!list.projectId && attachableProjects.length > 0 && (
          <div className="flex items-center gap-2 pt-1" data-testid="attach-project-row">
            <span className="text-xs theme-text-muted shrink-0">or attach to</span>
            <select
              value={attachTargetId}
              onChange={(e) => setAttachTargetId(e.target.value)}
              disabled={isAttaching}
              aria-label="Attach to existing project"
              className="flex-1 min-w-0 text-xs theme-comment-bg theme-border border theme-text-primary rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">an existing project…</option>
              {attachableProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!attachTargetId || isAttaching}
              onClick={handleAttachToProject}
              className="shrink-0"
            >
              {isAttaching ? "Attaching..." : "Attach"}
            </Button>
          </div>
        )}
        {projectBoardError ? (
          <p className="text-xs text-red-500">{projectBoardError}</p>
        ) : null}
      </div>

      {showDisableBoardConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !isRemovingProjectBoard && setShowDisableBoardConfirmation(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">Disable Board View</h3>
              <p className="theme-text-secondary mb-2">
                Tasks stay in this list, but the Ready/Doing/Waiting columns will be removed.
              </p>
              <p className="text-sm theme-text-muted">
                Tasks currently in a status column will lose their status. Completed tasks stay completed.
              </p>
            </div>
            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={isRemovingProjectBoard}
                onClick={() => setShowDisableBoardConfirmation(false)}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isRemovingProjectBoard}
                onClick={handleRemoveProjectBoard}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isRemovingProjectBoard ? "Disabling..." : "Disable Board"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
