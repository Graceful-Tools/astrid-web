"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { KanbanSquare } from "lucide-react"
import type { TaskList } from "@/types/task"

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

  const handleCreateProjectBoard = useCallback(async () => {
    if (list.projectId || isCreatingProjectBoard) return

    setIsCreatingProjectBoard(true)
    setProjectBoardError(null)

    try {
      // Single atomic call: creates the project AND attaches this list in one
      // transaction (no orphan-project window from a failed second request).
      const response = await fetch('/api/projects/from-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: list.id }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create board')
      }

      const { project, list: updatedList } = await response.json()
      onUpdate(updatedList)

      if (project?.lists?.length) {
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
