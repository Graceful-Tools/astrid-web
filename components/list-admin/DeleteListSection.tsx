"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import type { TaskList } from "@/types/task"

interface DeleteListSectionProps {
  list: TaskList
  canEditSettings: boolean
  onDelete: (listId: string) => void
}

/**
 * Delete List control for a list's admin settings: the destructive
 * button and its confirmation modal. Extracted from list-admin-settings.tsx
 * (Stage 13 of the god-file refactor).
 */
export function DeleteListSection({ list, canEditSettings, onDelete }: DeleteListSectionProps) {
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)

  if (!canEditSettings) return null

  return (
    <>
      <div className="border-t theme-border pt-4">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowDeleteConfirmation(true)}
          className="w-full text-red-400 hover:text-red-300 hover:bg-red-900/20"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete List
        </Button>
      </div>

      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirmation(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">Delete List</h3>
              <p className="theme-text-secondary mb-2">
                Are you sure you want to delete &quot;{list.name}&quot;?
              </p>
              <p className="text-sm theme-text-muted">
                This action cannot be undone. All tasks in this list will remain but will no longer be associated with this list.
              </p>
            </div>
            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirmation(false)}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Don&apos;t Delete
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(list.id)
                  setShowDeleteConfirmation(false)
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
