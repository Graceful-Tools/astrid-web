"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { SecureAttachmentViewer } from "./secure-attachment-viewer"
import { TaskCheckbox } from "./task-checkbox"
import { PublicTaskCopyButton } from "./public-task-copy-button"
import { CommentSection } from "./task-detail/CommentSection"
import { UserLink } from "./user-link"
import type { Task, User, TaskList } from "../types/task"
import { Calendar as CalendarIcon, Copy, Globe, Users, Share2, Clock, Timer } from "lucide-react"
import { format } from "date-fns"
import { formatDateForDisplay } from "@/lib/date-utils"
import { useTheme } from "@/contexts/theme-context"
import { useSSESubscription } from "@/hooks/use-sse-subscription"
import { renderMarkdownWithLinks } from "@/lib/markdown"
import { getAllListMembers } from "@/lib/list-member-utils"
import { formatConciseTime } from "./ui/time-picker"
import { isPublicListTask, shouldHideTaskPriority, shouldHideTaskWhen } from "@/lib/public-list-utils"
import { TaskTimer } from "./task-timer"

// Stable event type arrays to prevent re-subscriptions
const TASK_DETAIL_EVENT_TYPES = [
  'comment_created',
  'comment_updated',
  'comment_deleted',
  'task_updated'
] as const

interface TaskDetailViewOnlyProps {
  task: Task
  currentUser: User
  onUpdate: (task: Task) => void
  onLocalUpdate?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void
  onClose?: () => void
  onCopy?: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  availableLists?: TaskList[]
  swipeToDismiss?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
}

export function TaskDetailViewOnly({
  task,
  currentUser,
  onUpdate,
  onLocalUpdate,
  onClose,
  onCopy,
  availableLists = [],
  swipeToDismiss
}: TaskDetailViewOnlyProps) {
  const { theme } = useTheme()

  // Arrow positioning state
  const [arrowTop, setArrowTop] = useState(120)

  // Modal states
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false)
  const [copyIncludeComments, setCopyIncludeComments] = useState(false)
  const [copyTargetListId, setCopyTargetListId] = useState<string | undefined>("")  // Default to "My Tasks (only)"
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [loadingShareUrl, setLoadingShareUrl] = useState(false)
  const [shareUrlCopied, setShareUrlCopied] = useState(false)

  // Comment section state (minimal for view-only)
  const [newComment, setNewComment] = useState("")
  const [uploadingFile, setUploadingFile] = useState(false)
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState("")
  const [replyAttachedFile, setReplyAttachedFile] = useState<FileAttachment | null>(null)
  const [uploadingReplyFile, setUploadingReplyFile] = useState(false)
  const [showingActionsFor, setShowingActionsFor] = useState<string | null>(null)
  const [showTimer, setShowTimer] = useState(false)

  // Ref for latest task - used by SSE callbacks to avoid stale closure issues
  const taskRef = useRef(task)
  taskRef.current = task

// FileAttachment type definition
interface FileAttachment {
  url: string
  name: string
  type: string
  size: number
}

  const isNewTask = task.id.startsWith('new-')

  // Determine if user can comment based on list type
  const taskList = task.lists?.[0] // Primary list for this task
  const isCollaborative = taskList?.publicListType === 'collaborative'
  const canComment = isCollaborative // Users can comment on collaborative lists

  // Priority color helper
  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3: return 'rgb(239, 68, 68)' // Red
      case 2: return 'rgb(251, 191, 36)' // Yellow
      case 1: return 'rgb(59, 130, 246)' // Blue
      default: return 'rgb(107, 114, 128)' // Gray
    }
  }

  // Helper function to get list privacy icon
  const getListPrivacyIcon = (list: any) => {
    const privacy = list?.privacy

    if (!privacy && !list) {
      return null
    }

    if (privacy === 'PUBLIC') {
      return <Globe className="w-4 h-4 text-green-500" />
    }

    const allMembers = getAllListMembers(list)
    const hasAdditionalMembers = allMembers.length > 1
    if (hasAdditionalMembers) {
      return <Users className="w-4 h-4 text-blue-500" />
    }

    return null
  }

  // Arrow positioning
  useEffect(() => {
    const panelElement = document.querySelector('[data-task-detail-panel]') as HTMLElement

    const updateArrowPosition = () => {
      try {
        const currentTaskElement = document.querySelector(`[data-task-id="${task.id}"]`) as HTMLElement

        if (!currentTaskElement || !panelElement) {
          return
        }

        const taskRect = currentTaskElement.getBoundingClientRect()

        if (taskRect.height > 0) {
          const panelRect = panelElement.getBoundingClientRect()
          const taskCenter = taskRect.top + taskRect.height / 2
          const panelTop = panelRect.top
          const relativePosition = taskCenter - panelTop
          const arrowOffset = 10
          const minTop = 20
          const maxTop = panelRect.height - 40
          const finalTop = Math.max(minTop, Math.min(maxTop, relativePosition - arrowOffset))

          setArrowTop(finalTop)
        }
      } catch (error) {
        // Silently handle errors
      }
    }

    updateArrowPosition()
    const rafId = requestAnimationFrame(updateArrowPosition)

    const currentTaskElement = document.querySelector(`[data-task-id="${task.id}"]`) as HTMLElement
    const taskContainer = currentTaskElement?.closest('.overflow-y-auto')
    if (taskContainer) {
      taskContainer.addEventListener('scroll', updateArrowPosition, { passive: true })
    }

    window.addEventListener('resize', updateArrowPosition, { passive: true })

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateArrowPosition)
      if (panelElement) {
        resizeObserver.observe(panelElement)
      }
      if (currentTaskElement) {
        resizeObserver.observe(currentTaskElement)
      }
    }

    return () => {
      cancelAnimationFrame(rafId)
      if (taskContainer) {
        taskContainer.removeEventListener('scroll', updateArrowPosition)
      }
      window.removeEventListener('resize', updateArrowPosition)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [task.id])

  // Subscribe to SSE events for real-time updates
  // Uses taskRef.current to always access the latest task state and avoid stale closure issues
  useSSESubscription(TASK_DETAIL_EVENT_TYPES, (event) => {
    if (isNewTask) {
      return
    }

    // Always use taskRef.current to get the latest task state
    const currentTask = taskRef.current

    switch (event.type) {
      case 'comment_created': {
        // Comment events are now handled by the controller (useTaskManagerController)
        // which updates the task's comments locally without triggering an API call.
        // TaskDetailViewOnly will automatically re-render when the task prop changes.
        // No action needed here to prevent duplicate handling.
        if (process.env.NODE_ENV === 'development') {
          console.log(`📡 [TaskDetailViewOnly] Comment event received - handled by controller`)
        }
        break
      }

      case 'task_updated': {
        const { task: updatedTask, userId } = event.data
        if (userId === currentUser.id) {
          return
        }
        if (updatedTask.id === currentTask.id && updatedTask.comments && updatedTask.comments.length > (currentTask.comments || []).length) {
          onUpdate(updatedTask)
        }
        break
      }

      case 'comment_updated': {
        const { taskId, comment, userId } = event.data
        if (taskId === currentTask.id && userId !== currentUser.id) {
          const existingComments = currentTask.comments || []
          const updatedComments = existingComments.map(c =>
            c.id === comment.id ? { ...c, ...comment } : c
          )
          onUpdate({
            ...currentTask,
            comments: updatedComments
          })
        }
        break
      }

      case 'comment_deleted': {
        const { taskId, commentId, userId } = event.data
        if (taskId === currentTask.id && userId !== currentUser.id) {
          const existingComments = currentTask.comments || []
          const filteredComments = existingComments.filter(c => c.id !== commentId)
          onUpdate({
            ...currentTask,
            comments: filteredComments
          })
        }
        break
      }
    }
  }, {
    enabled: !isNewTask,
    componentName: 'TaskDetailViewOnly'
  })

  const handleToggleComplete = async () => {
    const newCompleted = !task.completed
    try {
      await onUpdate({ ...task, completed: newCompleted })
    } catch (error) {
      console.error('Failed to toggle task completion:', error)
    }
  }

  // Copy confirmation handlers
  const handleCopyClick = () => {
    setCopyIncludeComments(false)
    setCopyTargetListId("")  // Default to "My Tasks (only)"
    setShowCopyConfirmation(true)
  }

  const handleConfirmCopy = async () => {
    try {
      if (onCopy) {
        await onCopy(task.id, copyTargetListId, copyIncludeComments)
      }
      setShowCopyConfirmation(false)
      if (onClose) {
        onClose()
      }
    } catch (error) {
      console.error('Failed to copy task:', error)
    }
  }

  const handleCancelCopy = () => {
    setShowCopyConfirmation(false)
  }

  // Share handlers
  const handleShareClick = async () => {
    setShowShareModal(true)
    setShareUrlCopied(false)
    setShareUrl(null)
    setLoadingShareUrl(true)

    try {
      const response = await fetch('/api/shortcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'task',
          targetId: task.id
        })
      })

      if (response.ok) {
        const data = await response.json()
        if (data.url) {
          setShareUrl(data.url)
        } else {
          setShareUrl(null)
        }
      } else {
        setShareUrl(null)
      }
    } catch (error) {
      console.error('Error generating share URL:', error)
      setShareUrl(null)
    } finally {
      setLoadingShareUrl(false)
    }
  }

  const handleCopyShareUrl = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        setShareUrlCopied(true)
        setTimeout(() => setShareUrlCopied(false), 2000)
      } catch (error) {
        console.error('Failed to copy URL:', error)
      }
    }
  }

  const handleCloseShareModal = () => {
    setShowShareModal(false)
    setShareUrl(null)
    setShareUrlCopied(false)
  }

  const priorityLabels = {
    0: "None",
    1: "Low",
    2: "Medium",
    3: "High",
  }

  return (
    <>
      {/* Arrow rendered outside the panel div so it escapes overflow:hidden */}
      {!onClose ? (
        <div
          className="task-panel-arrow theme-panel-arrow"
          style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
        ></div>
      ) : (
        <div
          className="task-panel-arrow theme-panel-arrow hidden cols2:block"
          style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
        ></div>
      )}
    <div className={`${onClose ? 'w-full' : 'task-panel'} theme-panel flex flex-col h-full relative`} data-task-detail-panel {...(swipeToDismiss || {})}>

      <div className="border-b border-gray-200 dark:border-gray-700">
        {/* Mobile/Tablet Back Navigation */}
        {onClose && (
          <div className="cols2:hidden app-header theme-header theme-border relative">
            <Button
              variant="ghost"
              onClick={onClose}
              className="w-full flex items-center justify-start theme-text-primary hover:theme-text-secondary rounded-none hover:theme-bg-hover"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <polyline points="15,18 9,12 15,6"></polyline>
              </svg>
              <span className="text-lg font-semibold">Back to List</span>
            </Button>
          </div>
        )}

        {/* Task Title Row - View Only */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1">
              {isPublicListTask(task) ? (
                <PublicTaskCopyButton
                  onCopy={handleCopyClick}
                />
              ) : (
                <TaskCheckbox
                  checked={task.completed}
                  onToggle={handleToggleComplete}
                  priority={task.priority}
                  repeating={task.repeating !== 'never'}
                />
              )}
              <span
                className={`text-lg flex-1 ${
                  task.completed ? "line-through theme-text-muted" : "theme-text-primary"
                }`}
              >
                {task.title}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-4">
        {/* Creator for public list tasks, Assignee for regular tasks - View Only */}
        {isPublicListTask(task) ? (
          task.creator && (
            <div className="grid grid-cols-3 gap-4 items-center">
              <Label className="text-sm theme-text-muted">Created by</Label>
              <div className="flex items-center space-x-2 col-span-2 px-2 py-1 rounded">
                <UserLink
                  user={task.creator}
                  showAvatar={true}
                  avatarSize="sm"
                  className="text-blue-600 dark:text-blue-400"
                />
              </div>
            </div>
          )
        ) : (
          task.assignee && !shouldHideTaskPriority(task) && (
            <div className="grid grid-cols-3 gap-4 items-center">
              <Label className="text-sm theme-text-muted">Who</Label>
              <div className="flex items-center space-x-2 col-span-2 px-2 py-1 rounded">
                <UserLink
                  user={task.assignee}
                  showAvatar={true}
                  avatarSize="sm"
                  className="text-blue-600 dark:text-blue-400"
                />
              </div>
            </div>
          )
        )}

        {/* Due Date (When) - View Only (always show with placeholder) */}
        {!shouldHideTaskWhen(task) && (
        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm theme-text-muted">Date</Label>
          {task.dueDateTime ? (
            <div className="flex items-center space-x-2 col-span-2 px-2 py-1 rounded">
              <CalendarIcon className="w-4 h-4 theme-text-muted" />
              <span className="text-blue-600 dark:text-blue-400">
                {formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay)}
              </span>
              {task.dueDateTime && new Date(task.dueDateTime).getHours() !== 0 && (
                <>
                  <Clock className="w-4 h-4 theme-text-muted ml-2" />
                  <span className="text-blue-600 dark:text-blue-400">
                    {formatConciseTime(new Date(task.dueDateTime))}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="text-sm theme-text-muted col-span-2 px-2 py-1 rounded">
              No date
            </div>
          )}
        </div>
        )}

        {/* Repeating - View Only */}
        {!shouldHideTaskWhen(task) && task.repeating && task.repeating !== 'never' && (
          <div className="grid grid-cols-3 gap-4 items-center">
            <Label className="text-sm theme-text-muted">Repeat</Label>
            <div className="text-blue-600 dark:text-blue-400 col-span-2 px-2 py-1 rounded capitalize">
              {task.repeating}
            </div>
          </div>
        )}

        {/* Priority - View Only as Selected Button */}
        {!shouldHideTaskPriority(task) && (
        <div className="grid grid-cols-3 gap-4 items-center">
          <Label className="text-sm theme-text-muted">Priority</Label>
          <div className="col-span-2">
            <div className="flex space-x-2 mt-1">
              {/* Show single selected button based on priority */}
              <Button
                size="sm"
                variant="outline"
                disabled
                className={`w-10 h-10 flex items-center justify-center pointer-events-none ${
                  task.priority === 0
                    ? "bg-gray-500 !text-white border-gray-500"
                    : task.priority === 1
                    ? "bg-blue-500 !text-white border-blue-500"
                    : task.priority === 2
                    ? "bg-yellow-500 !text-white border-yellow-500"
                    : "bg-red-500 !text-white border-red-500"
                }`}
              >
                <span>
                  {task.priority === 0 ? '○' : task.priority === 1 ? '!' : task.priority === 2 ? '!!' : '!!!'}
                </span>
              </Button>
            </div>
          </div>
        </div>
        )}

        {/* Description - View Only (always show with placeholder) */}
        <div className="grid grid-cols-3 gap-4 items-start">
          <Label className="text-sm theme-text-muted">Description</Label>
          {task.description ? (
            <div
              className="text-sm theme-text-primary col-span-2 px-2 py-1 rounded"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLinks(task.description, { codeClass: 'theme-bg-tertiary px-1 rounded text-sm' })
              }}
            />
          ) : (
            <div className="text-sm theme-text-muted col-span-2 px-2 py-1 rounded">
              (no description)
            </div>
          )}
        </div>

        {/* All Attachments Section */}
        {(() => {
          const secureFileAttachments = (task.comments || [])
            .flatMap(comment =>
              (comment.secureFiles || []).map((file: any) => ({
                id: `secure-${file.id}`,
                fileId: file.id,
                name: file.originalName,
                type: file.mimeType,
                size: file.fileSize,
                source: `Comment by ${comment.author?.name || comment.author?.email || 'System'}`,
                createdAt: comment.createdAt,
                isSecure: true
              }))
            )

          const allAttachments: Array<any> = [...secureFileAttachments]

          return allAttachments.length > 0 ? (
            <div>
              <Label className="text-sm theme-text-muted">
                All Attachments ({allAttachments.length})
              </Label>
              <div className="space-y-3 mt-1">
                {allAttachments.map((attachment) => (
                  <div key={attachment.id} className="space-y-1">
                    <SecureAttachmentViewer
                      fileId={attachment.fileId}
                      fileName={attachment.name}
                      className="mb-1"
                    />
                    {attachment.source && (
                      <p className="text-xs theme-text-muted ml-12 sm:ml-20">
                        From: {attachment.source}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null
        })()}

        {/* Comments Section - Enabled for collaborative lists, hidden for copy-only */}
        <CommentSection
          task={task}
          currentUser={currentUser}
          onUpdate={onUpdate}
          onLocalUpdate={onLocalUpdate}
          readOnly={!canComment}
          newComment={newComment}
          setNewComment={setNewComment}
          uploadingFile={uploadingFile}
          setUploadingFile={setUploadingFile}
          attachedFile={attachedFile}
          setAttachedFile={setAttachedFile}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingTo}
          replyContent={replyContent}
          setReplyContent={setReplyContent}
          replyAttachedFile={replyAttachedFile}
          setReplyAttachedFile={setReplyAttachedFile}
          uploadingReplyFile={uploadingReplyFile}
          setUploadingReplyFile={setUploadingReplyFile}
          showingActionsFor={showingActionsFor}
          setShowingActionsFor={setShowingActionsFor}
        />

        {/* Timer Button */}
        <div className="mt-4 px-4">
          <Button
            variant="outline"
            className="w-full flex items-center justify-center gap-2 py-6 text-lg"
            onClick={() => setShowTimer(true)}
          >
            <Timer className="w-5 h-5" />
            Timer
          </Button>
          {task.lastTimerValue && (
            <p className="mt-2 text-sm theme-text-muted text-center">
              Last: {task.lastTimerValue}
            </p>
          )}
        </div>

        {showTimer && (
          <TaskTimer
            task={task}
            onClose={() => setShowTimer(false)}
            onUpdate={onUpdate}
          />
        )}

        {/* Action Buttons - Copy and Share only */}
        <div className="pt-8 pb-32 md:pb-4 flex flex-wrap justify-center gap-3 border-t border-gray-200 dark:border-gray-700 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyClick}
            className="border-blue-600 text-blue-400 bg-transparent hover:bg-blue-600 hover:border-blue-600 hover:text-white"
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleShareClick}
            className="border-green-600 text-green-400 bg-transparent hover:bg-green-600 hover:border-green-600 hover:text-white"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>
      </div>

      {/* Copy Confirmation Modal */}
      {showCopyConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="theme-panel p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold theme-text-primary mb-4">Copy Task</h3>
            <div className="space-y-4">
              <div>
                <Label className="text-sm theme-text-muted">Target List</Label>
                <select
                  value={copyTargetListId}
                  onChange={(e) => setCopyTargetListId(e.target.value)}
                  className="w-full mt-1 p-2 rounded border border-gray-300 dark:border-gray-600 theme-bg theme-text-primary"
                >
                  <option value="">My Tasks (only)</option>
                  {availableLists.filter(list => !list.isVirtual).map(list => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="includeComments"
                  checked={copyIncludeComments}
                  onChange={(e) => setCopyIncludeComments(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="includeComments" className="text-sm theme-text-primary cursor-pointer">
                  Include comments
                </Label>
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <Button variant="outline" onClick={handleCancelCopy}>Cancel</Button>
              <Button onClick={handleConfirmCopy}>Copy Task</Button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="theme-panel p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold theme-text-primary mb-4">Share Task</h3>
            {loadingShareUrl ? (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-sm theme-text-muted mt-2">Generating share link...</p>
              </div>
            ) : shareUrl ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm theme-text-muted">Share URL</Label>
                  <div className="flex items-center space-x-2 mt-1">
                    <input
                      type="text"
                      value={shareUrl}
                      readOnly
                      className="flex-1 p-2 rounded border border-gray-300 dark:border-gray-600 theme-bg theme-text-primary text-sm"
                    />
                    <Button size="sm" onClick={handleCopyShareUrl}>
                      {shareUrlCopied ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm theme-text-muted">Failed to generate share URL</p>
            )}
            <div className="flex justify-end mt-6">
              <Button variant="outline" onClick={handleCloseShareModal}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
