"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Trash2, Copy, Share2, Lock, Check, Link as LinkIcon } from "lucide-react"
import type { Task, TaskList } from "@/types/task"

interface TaskModalsProps {
  task: Task
  availableLists: TaskList[]

  // Delete modal state
  showDeleteConfirmation: boolean
  setShowDeleteConfirmation: (value: boolean) => void
  onDelete: (taskId: string) => void

  // Copy modal state
  showCopyConfirmation: boolean
  setShowCopyConfirmation: (value: boolean) => void
  copyIncludeComments: boolean
  setCopyIncludeComments: (value: boolean) => void
  copyTargetListId?: string
  setCopyTargetListId: (value: string | undefined) => void
  onCopy?: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  onClose?: () => void

  // Share modal state — supplied by useTaskShareLink, which owns both the
  // state and the copy/close actions. This component used to take the four
  // setters and re-implement `onCopyShareUrl`/`onCloseShareModal`
  // itself, which is how a third copy of the flow ended up here.
  showShareModal: boolean
  shareUrl: string | null
  loadingShareUrl: boolean
  shareUrlCopied: boolean
  onCopyShareUrl: () => void | Promise<void>
  onCloseShareModal: () => void
}

export function TaskModals({
  task,
  availableLists,
  showDeleteConfirmation,
  setShowDeleteConfirmation,
  onDelete,
  showCopyConfirmation,
  setShowCopyConfirmation,
  copyIncludeComments,
  setCopyIncludeComments,
  copyTargetListId,
  setCopyTargetListId,
  onCopy,
  onClose,
  showShareModal,
  shareUrl,
  loadingShareUrl,
  shareUrlCopied,
  onCopyShareUrl,
  onCloseShareModal
}: TaskModalsProps) {

  // Filter out virtual lists (Saved Filters)
  const realLists = availableLists.filter(list => !list.isVirtual)

  // Handler functions
  const handleCancelDelete = () => {
    setShowDeleteConfirmation(false)
  }

  const handleConfirmDelete = () => {
    onDelete(task.id)
    setShowDeleteConfirmation(false)
  }

  const handleCancelCopy = () => {
    setShowCopyConfirmation(false)
  }

  const handleConfirmCopy = async () => {
    try {
      if (onCopy) {
        // Use the parent's callback - it will handle the API call and reload data
        await onCopy(task.id, copyTargetListId, copyIncludeComments)
      } else {
        // Fallback: Use the API directly (shouldn't happen in normal TaskManager flow)
        const response = await fetch(`/api/v1/tasks/${task.id}/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetListId: copyTargetListId,
            preserveDueDate: true,
            preserveAssignee: false,
            includeComments: copyIncludeComments
          })
        })

        if (!response.ok) {
          throw new Error('Failed to copy task')
        }

        const result = await response.json()
        console.log('✅ Task copied successfully:', result.task?.id)
      }

      setShowCopyConfirmation(false)

      // Close task detail if onClose is provided
      if (onClose) {
        onClose()
      }
    } catch (error) {
      console.error('Failed to copy task:', error)
      // Error notification will be shown by parent's handleCopyTask
    }
  }

  return (
    <>
      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelDelete}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">Delete Task</h3>
              <p className="theme-text-secondary">
                Are you sure you want to delete &quot;{task.title}&quot;? This action cannot be undone.
              </p>
            </div>
            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelDelete}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Don&apos;t Delete
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Confirmation Modal - centered on task pane */}
      {showCopyConfirmation && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleCancelCopy}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2">Copy Task</h3>
              <p className="theme-text-secondary mb-4">
                Create a copy of &quot;{task.title}&quot;
              </p>

              {/* Copy Options */}
              <div className="space-y-4">
                {/* List Selection */}
                <div>
                  <label className="text-sm font-medium theme-text-primary mb-2 block">
                    Copy to list:
                  </label>
                  <select
                    value={copyTargetListId || ''}
                    onChange={(e) => setCopyTargetListId(e.target.value || undefined)}
                    className="w-full px-3 py-2 rounded-md theme-bg-primary theme-text-primary theme-border focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">My Tasks (only)</option>
                    {realLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Include Comments Checkbox */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-comments"
                    checked={copyIncludeComments}
                    onCheckedChange={(checked) => setCopyIncludeComments(checked === true)}
                  />
                  <label
                    htmlFor="include-comments"
                    className="text-sm theme-text-primary cursor-pointer"
                  >
                    Include comments ({task.comments?.length || 0} comment{task.comments?.length === 1 ? '' : 's'})
                  </label>
                </div>

                <div className="text-xs theme-text-muted">
                  The copied task will preserve the due date and will be assigned to you.
                </div>
              </div>
            </div>

            <div className="flex space-x-3 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelCopy}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleConfirmCopy}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal - centered on task pane */}
      {showShareModal && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCloseShareModal}>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <h3 className="text-lg font-semibold theme-text-primary mb-2 flex items-center">
                <Share2 className="w-5 h-5 mr-2" />
                Share Task
              </h3>

              <p className="theme-text-secondary mb-4">
                Create a shareable link for &quot;{task.title}&quot;
              </p>

              {task.isPrivate && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-4">
                  <div className="flex items-start space-x-2">
                    <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      This is a private task. Only users with access to this list can view it.
                    </p>
                  </div>
                </div>
              )}

              {loadingShareUrl ? (
                <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
                  <p className="theme-text-muted">Generating share link...</p>
                </div>
              ) : shareUrl ? (
                <div className="space-y-3">
                  <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <div className="flex items-center justify-between space-x-2">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <LinkIcon className="w-4 h-4 theme-text-muted flex-shrink-0" />
                        <span className="text-sm theme-text-primary truncate font-mono">
                          {shareUrl}
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onCopyShareUrl}
                        className={`flex-shrink-0 ${
                          shareUrlCopied
                            ? 'bg-green-600 text-white border-green-600'
                            : 'theme-border theme-text-secondary hover:theme-bg-hover'
                        }`}
                      >
                        {shareUrlCopied ? (
                          <>
                            <Check className="w-4 h-4 mr-1" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs theme-text-muted">
                    <p className="mb-1">🔗 Share this link with anyone who has access to view this task</p>
                    <p>📌 The link will redirect to the task in the app</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-800 dark:text-red-200">
                    Failed to generate share link. Please try again.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onCloseShareModal}
                className="theme-border theme-text-secondary hover:theme-bg-hover"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
