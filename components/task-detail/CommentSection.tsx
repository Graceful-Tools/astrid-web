"use client"

import { BRAND } from '@/lib/brand/config'
import { foldCompletionStreaks } from "@/lib/completion-streak"
import { StreakRow } from "@/components/task-detail/StreakRow"
import { useState, useRef, useMemo, useCallback, useEffect } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SecureAttachmentViewer } from "@/components/secure-attachment-viewer"
import { Paperclip, Send, X, Image as ImageIcon, FileText, Loader2, RefreshCw, Copy, Reply, Trash2, Pencil } from "lucide-react"
import { format } from "date-fns"
import { isMobileDevice } from "@/lib/layout-detection"
import { renderMarkdownWithLinks } from "@/lib/markdown"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import { RichTextInput } from "@/components/shared/RichTextInput"
import { MessageBubble } from "@/components/shared/MessageBubble"
import { uploadCommentFile as uploadCommentFileImpl } from "@/lib/comment-file-upload"
import type { Task, User } from "@/types/task"
import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"
import { hasExplicitListRole } from "@/lib/list-permissions"

// Helper function to display author name/email with fallback for system/deleted users
function getAuthorDisplay(author: User | null | undefined, isSystemComment: boolean = false): string {
  if (isSystemComment || !author) return "System"
  return author.name || author.email || "Unknown User"
}

function getAuthorInitial(author: User | null | undefined, isSystemComment: boolean = false): string {
  if (isSystemComment || !author) return "S" // "S" for System
  const display = author.name || author.email || "?"
  return display.charAt(0).toUpperCase()
}

/**
 * Adapter around lib/comment-file-upload that wires the pure helper to
 * the React state setters this component owns. Behavior preserved exactly.
 */
async function uploadCommentFile(
  file: File,
  taskId: string,
  setUploading: (value: boolean) => void,
  setAttachedFile: (value: FileAttachment | null) => void,
  setUploadError?: (error: string | null) => void,
): Promise<void> {
  setUploading(true)
  if (setUploadError) setUploadError(null)

  try {
    const result = await uploadCommentFileImpl(file, taskId)
    if (result.success) {
      setAttachedFile(result.attachment)
    } else if (setUploadError) {
      setUploadError(result.error)
    } else {
      alert("Failed to upload file. Please try again.")
    }
  } catch (error) {
    console.error("Error uploading file:", error)
    if (!setUploadError) {
      alert("Failed to upload file. Please try again.")
    }
  } finally {
    setUploading(false)
  }
}

interface CommentSectionProps {
  task: Task
  currentUser: User
  onUpdate: (updatedTask: Task) => void
  onLocalUpdate?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void  // Update local state only, no API call
  readOnly?: boolean  // If true, hide comment input
  hideInput?: boolean  // If true, hide the bottom input bar (rendered separately outside scroll area)
  onRefreshComments?: () => Promise<void>  // Callback to refresh comments from API
  /** Lists for # autocomplete in comments */
  lists?: import('@/types/task').TaskList[]
  /** Tasks for ! autocomplete in comments */
  tasks?: Task[]
  // Comment state from useTaskDetailState
  newComment: string
  setNewComment: (value: string) => void
  uploadingFile: boolean
  setUploadingFile: (value: boolean) => void
  attachedFile: FileAttachment | null
  setAttachedFile: (value: FileAttachment | null) => void
  replyingTo: string | null
  setReplyingTo: (value: string | null) => void
  replyContent: string
  setReplyContent: (value: string) => void
  replyAttachedFile: FileAttachment | null
  setReplyAttachedFile: (value: FileAttachment | null) => void
  uploadingReplyFile: boolean
  setUploadingReplyFile: (value: boolean) => void
  showingActionsFor: string | null
  setShowingActionsFor: (value: string | null) => void
  uploadError?: string | null
  setUploadError?: (value: string | null) => void
  replyUploadError?: string | null
  setReplyUploadError?: (value: string | null) => void
  agentTyping?: { isTyping: boolean; agentName: string | null }
}

// Props for the standalone input bar component
// CommentInputBar moved to ./CommentInputBar.tsx (Stage 12c). Re-exported
// below so existing callers continue to work.
export { CommentInputBar, type CommentInputBarProps } from "./CommentInputBar"

export function CommentSection({
  task,
  currentUser,
  onUpdate,
  onLocalUpdate,
  readOnly = false,
  hideInput = false,
  onRefreshComments,
  newComment,
  setNewComment,
  uploadingFile,
  setUploadingFile,
  attachedFile,
  setAttachedFile,
  replyingTo,
  setReplyingTo,
  replyContent,
  setReplyContent,
  replyAttachedFile,
  setReplyAttachedFile,
  uploadingReplyFile,
  setUploadingReplyFile,
  showingActionsFor,
  setShowingActionsFor,
  uploadError,
  setUploadError,
  replyUploadError,
  setReplyUploadError,
  lists: availableLists,
  tasks: availableTasks,
  agentTyping,
}: CommentSectionProps) {
  const [showSystemComments, setShowSystemComments] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [localUploadError, setLocalUploadError] = useState<string | null>(null)
  const [localReplyUploadError, setLocalReplyUploadError] = useState<string | null>(null)
  const [isRefreshingDesktop, setIsRefreshingDesktop] = useState(false)
  const commentsContainerRef = useRef<HTMLDivElement>(null)
  // Fetch Astrid agent for mention autocomplete
  const [defaultAgent, setDefaultAgent] = useState<User | null>(null)
  useEffect(() => {
    fetch('/api/user/available-agents')
      .then(r => r.json())
      .then((data) => {
        const astrid = (data.agents || []).find((a: { email: string }) => a.email === `astrid@${BRAND.agentEmailDomain}`)
        if (astrid) {
          setDefaultAgent({
            id: astrid.id, name: astrid.name, email: astrid.email,
            image: astrid.image, createdAt: new Date(), isAIAgent: true,
          })
        }
      })
      .catch(() => {})
  }, [])

  const mentionableUsers = useMemo(() => {
    const users = new Map<string, User>()

    // Add Astrid/default agent first
    if (defaultAgent) users.set(defaultAgent.id, defaultAgent)

    if (task.creator) users.set(task.creator.id, task.creator)
    if (task.assignee) users.set(task.assignee.id, task.assignee)

    task.lists?.forEach(list => {
      if (list.owner) users.set(list.owner.id, list.owner)
      list.members?.forEach(member => users.set(member.id, member))
      list.listMembers?.forEach(lm => {
        if (lm.user) users.set(lm.user.id, lm.user)
      })
      list.admins?.forEach(admin => users.set(admin.id, admin))
    })

    return Array.from(users.values()).filter(u => u.id !== currentUser.id)
  }, [task, currentUser.id, defaultAgent])

  // Use provided error state or local state
  const uploadErrorState = uploadError ?? localUploadError
  const setUploadErrorState = setUploadError ?? setLocalUploadError
  const replyUploadErrorState = replyUploadError ?? localReplyUploadError
  const setReplyUploadErrorState = setReplyUploadError ?? setLocalReplyUploadError

  // Desktop refresh handler
  const handleDesktopRefresh = async () => {
    if (!onRefreshComments || isRefreshingDesktop) return
    setIsRefreshingDesktop(true)
    try {
      await onRefreshComments()
    } finally {
      setIsRefreshingDesktop(false)
    }
  }

  // Initialize pull-to-refresh hook
  const pullToRefresh = usePullToRefresh({
    threshold: 60,
    maxDistance: 120,
    onRefresh: onRefreshComments,
    disabled: !isMobileDevice() || !onRefreshComments
  })

  // Bind the comments container to the pull-to-refresh hook
  const { bindToElement, onTouchStart, onTouchMove, onTouchEnd, isRefreshing, pullDistance, isPulling, canRefresh } = pullToRefresh

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await uploadCommentFile(file, task.id, setUploadingFile, setAttachedFile, setUploadErrorState)
  }

  const handleAddComment = async () => {
    if (!newComment.trim() && !attachedFile) return

    const { nanoid } = await import('nanoid')
    const { OfflineSyncManager, isOfflineMode } = await import('@/lib/offline-sync')
    const { OfflineCommentOperations } = await import('@/lib/offline-db')

    const tempId = `temp-${nanoid()}`
    const commentData = {
      content: newComment.trim() || (attachedFile ? `Attached: ${attachedFile.name}` : ''),
      type: attachedFile ? "ATTACHMENT" as const : "TEXT" as const,
      fileId: attachedFile ? attachedFile.url.split('/').pop() : undefined
    }

    // Create optimistic comment for immediate UI update
    const optimisticComment = {
      id: tempId,
      content: commentData.content,
      type: commentData.type,
      author: currentUser,
      authorId: currentUser.id,
      taskId: task.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentCommentId: undefined,
      replies: [],
      secureFiles: attachedFile ? [{
        id: commentData.fileId || 'temp-file',
        originalName: attachedFile.name,
        mimeType: attachedFile.type || 'application/octet-stream',
        fileSize: attachedFile.size || 0,
        uploadedBy: currentUser.id,
        uploadedAt: new Date(),
        commentId: tempId
      }] : []
    }

    // Store original values for potential rollback
    const originalComment = newComment
    const originalFile = attachedFile

    // Clear inputs immediately for better UX
    setNewComment("")
    setAttachedFile(null)

    // Check if this is a collaborative public list where user doesn't have edit permissions
    const taskList = task.lists?.[0]
    const isCollaborativePublic = taskList?.privacy === 'PUBLIC' && taskList?.publicListType === 'collaborative'

    // Check if user has edit permissions (owner, admin, or member)
    // For collaborative public lists, non-members can comment but shouldn't trigger optimistic updates
    const hasEditPermissions = hasExplicitListRole(currentUser, taskList as never)

    // Skip optimistic update for collaborative public lists where user doesn't have edit permissions
    // The comment will appear via onLocalUpdate instead, avoiding 403 errors on task update
    const shouldSkipOptimisticUpdate = isCollaborativePublic && !hasEditPermissions

    if (!shouldSkipOptimisticUpdate) {
      // Update UI optimistically (only for users with edit permissions)
      // Use onLocalUpdate to avoid triggering full task PUT request
      if (onLocalUpdate) {
        // Function-based update for onLocalUpdate to avoid stale closure
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return {
            ...currentTask,
            comments: [...(currentTask.comments || []), optimisticComment as any],
          }
        })
      } else {
        // Object-based update for onUpdate (fallback)
        onUpdate({
          ...task,
          comments: [...(task.comments || []), optimisticComment as any],
        })
      }
    }

    try {
      // Check if offline
      if (isOfflineMode()) {
        // Save comment locally
        await OfflineCommentOperations.saveComment(optimisticComment as any)

        // Queue mutation for sync
        await OfflineSyncManager.queueMutation(
          'create',
          'comment',
          tempId,
          `/api/tasks/${task.id}/comments`,
          'POST',
          commentData,
          task.id // parentId for dependency tracking
        )

        console.log('💬 Comment queued for offline sync')
        return
      }

      // Send the actual comment to the server
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(commentData),
      })

      if (!response.ok) {
        throw new Error('Failed to add comment')
      }

      const serverComment = await response.json()

      // Save to local cache
      await OfflineCommentOperations.saveComment(serverComment)

      // Update the UI with the server comment
      if (!shouldSkipOptimisticUpdate) {
        // For members: Replace the optimistic comment with the server version
        // Use function update to avoid stale closure issues
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return {
              ...currentTask,
              comments: (currentTask.comments || []).map(comment =>
                comment.id === tempId ? serverComment : comment
              ),
            }
          })
        } else {
          onUpdate({
            ...task,
            comments: (task.comments || []).map(comment =>
              comment.id === tempId ? serverComment : comment
            ),
          })
        }
      } else {
        // For non-members: Use onLocalUpdate to update UI without triggering API call
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return {
              ...currentTask,
              comments: [...(currentTask.comments || []), serverComment],
            }
          })
        }
      }

    } catch (error) {
      console.error("Error adding comment:", error)

      // Revert optimistic update on failure (only if we did one)
      if (!shouldSkipOptimisticUpdate) {
        // Use onLocalUpdate to avoid triggering full task PUT request
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return {
              ...currentTask,
              comments: (currentTask.comments || []).filter(comment => comment.id !== tempId),
            }
          })
        } else {
          onUpdate({
            ...task,
            comments: (task.comments || []).filter(comment => comment.id !== tempId),
          })
        }
      }

      // Restore the input values
      setNewComment(originalComment)
      setAttachedFile(originalFile)
    }
  }

  const handleReplyFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await uploadCommentFile(file, task.id, setUploadingReplyFile, setReplyAttachedFile, setReplyUploadErrorState)
  }

  const handleDeleteComment = async (commentId: string) => {
    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to delete comment')
      }

      // Optimistically remove the comment from the UI
      // Use onLocalUpdate to avoid triggering full task PUT request
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return {
            ...currentTask,
            comments: (currentTask.comments || []).filter(c => c.id !== commentId),
          }
        })
      } else {
        // Object-based update for onUpdate (fallback)
        onUpdate({
          ...task,
          comments: (task.comments || []).filter(c => c.id !== commentId),
        })
      }
    } catch (error) {
      console.error("Error deleting comment:", error)
    }
  }

  const handleEditComment = async (commentId: string, content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: trimmed }),
      })

      if (!response.ok) {
        throw new Error('Failed to update comment')
      }

      // Optimistically update the comment (top-level or nested reply)
      // Use onLocalUpdate to avoid triggering full task PUT request
      const applyEdit = (comments: any[]) => comments.map(comment => {
        if (comment.id === commentId) {
          return { ...comment, content: trimmed, updatedAt: new Date().toISOString() }
        }
        if (comment.replies?.some((reply: any) => reply.id === commentId)) {
          return {
            ...comment,
            replies: comment.replies.map((reply: any) =>
              reply.id === commentId
                ? { ...reply, content: trimmed, updatedAt: new Date().toISOString() }
                : reply
            ),
          }
        }
        return comment
      })
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return { ...currentTask, comments: applyEdit(currentTask.comments || []) }
        })
      } else {
        onUpdate({ ...task, comments: applyEdit(task.comments || []) })
      }
    } catch (error) {
      console.error("Error updating comment:", error)
    } finally {
      setEditingCommentId(null)
      setEditingText("")
    }
  }

  const handleDeleteReply = async (replyId: string, parentCommentId: string) => {
    try {
      const response = await fetch(`/api/comments/${replyId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to delete reply')
      }

      // Optimistically remove the reply from the UI
      // Use onLocalUpdate to avoid triggering full task PUT request
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return {
            ...currentTask,
            comments: (currentTask.comments || []).map(comment => {
              if (comment.id === parentCommentId) {
                return {
                  ...comment,
                  replies: (comment.replies || []).filter(reply => reply.id !== replyId)
                }
              }
              return comment
            }),
          }
        })
      } else {
        // Object-based update for onUpdate (fallback)
        onUpdate({
          ...task,
          comments: (task.comments || []).map(comment => {
            if (comment.id === parentCommentId) {
              return {
                ...comment,
                replies: (comment.replies || []).filter(reply => reply.id !== replyId)
              }
            }
            return comment
          }),
        })
      }
    } catch (error) {
      console.error("Error deleting reply:", error)
    }
  }

  const handleAddReply = async (parentCommentId: string) => {
    if (!replyContent.trim() && !replyAttachedFile) return

    const { nanoid } = await import('nanoid')
    const { OfflineSyncManager, isOfflineMode } = await import('@/lib/offline-sync')
    const { OfflineCommentOperations } = await import('@/lib/offline-db')

    const tempId = `temp-reply-${nanoid()}`
    const replyData = {
      content: replyContent.trim() || (replyAttachedFile ? `Attached: ${replyAttachedFile.name}` : ''),
      type: replyAttachedFile ? "ATTACHMENT" as const : "TEXT" as const,
      parentCommentId,
      fileId: replyAttachedFile ? replyAttachedFile.url.split('/').pop() : undefined
    }

    // Create optimistic reply for immediate UI update
    const optimisticReply = {
      id: tempId,
      content: replyData.content,
      type: replyData.type,
      author: currentUser,
      authorId: currentUser.id,
      taskId: task.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentCommentId,
      replies: [],
      secureFiles: replyAttachedFile ? [{
        id: replyData.fileId || 'temp-reply-file',
        originalName: replyAttachedFile.name,
        mimeType: replyAttachedFile.type || 'application/octet-stream',
        fileSize: replyAttachedFile.size || 0,
        uploadedBy: currentUser.id,
        uploadedAt: new Date(),
        commentId: tempId
      }] : []
    }

    // Store original values for potential rollback
    const originalReply = replyContent
    const originalReplyFile = replyAttachedFile

    // Clear inputs immediately for better UX
    setReplyContent("")
    setReplyAttachedFile(null)
    setReplyingTo(null)

    // Update UI optimistically
    // Use onLocalUpdate to avoid triggering full task PUT request
    if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
        if (currentTask.id !== task.id) return currentTask
        return {
          ...currentTask,
          comments: (currentTask.comments || []).map(comment => {
            if (comment.id === parentCommentId) {
              return {
                ...comment,
                replies: [...(comment.replies || []), optimisticReply as any]
              }
            }
            return comment
          }),
        }
      })
    } else {
      // Object-based update for onUpdate (fallback)
      onUpdate({
        ...task,
        comments: (task.comments || []).map(comment => {
          if (comment.id === parentCommentId) {
            return {
              ...comment,
              replies: [...(comment.replies || []), optimisticReply as any]
            }
          }
          return comment
        }),
      })
    }

    try {
      // Check if offline
      if (isOfflineMode()) {
        // Save reply locally
        await OfflineCommentOperations.saveComment(optimisticReply as any)

        // Queue mutation for sync
        await OfflineSyncManager.queueMutation(
          'create',
          'comment',
          tempId,
          `/api/tasks/${task.id}/comments`,
          'POST',
          replyData,
          task.id // parentId for dependency tracking
        )

        console.log('💬 Reply queued for offline sync')
        return
      }

      // Send the actual reply to the server
      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(replyData),
      })

      if (!response.ok) {
        throw new Error('Failed to add reply')
      }

      const serverReply = await response.json()

      // Save to local cache
      await OfflineCommentOperations.saveComment(serverReply)

      // Replace the optimistic reply with the server version
      // Use onLocalUpdate to avoid triggering full task PUT request
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return {
            ...currentTask,
            comments: (currentTask.comments || []).map(comment => {
              if (comment.id === parentCommentId) {
                return {
                  ...comment,
                  replies: (comment.replies || []).map(reply =>
                    reply.id === tempId ? serverReply : reply
                  )
                }
              }
              return comment
            }),
          }
        })
      } else {
        // Object-based update for onUpdate (fallback)
        onUpdate({
          ...task,
          comments: (task.comments || []).map(comment => {
            if (comment.id === parentCommentId) {
              return {
                ...comment,
                replies: (comment.replies || []).map(reply =>
                  reply.id === tempId ? serverReply : reply
                )
              }
            }
            return comment
          }),
        })
      }

    } catch (error) {
      console.error("Error adding reply:", error)

      // Revert optimistic update on failure
      // Use onLocalUpdate to avoid triggering full task PUT request
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return {
            ...currentTask,
            comments: (currentTask.comments || []).map(comment => {
              if (comment.id === parentCommentId) {
                return {
                  ...comment,
                  replies: (comment.replies || []).filter(reply => reply.id !== tempId)
                }
              }
              return comment
            }),
          }
        })
      } else {
        // Object-based update for onUpdate (fallback)
        onUpdate({
          ...task,
          comments: (task.comments || []).map(comment => {
            if (comment.id === parentCommentId) {
              return {
                ...comment,
                replies: (comment.replies || []).filter(reply => reply.id !== tempId)
              }
            }
            return comment
          }),
        })
      }

      // Restore the input values
      setReplyContent(originalReply)
      setReplyAttachedFile(originalReplyFile)
      setReplyingTo(parentCommentId)
    }
  }

  const userComments = (task.comments || []).filter(c => c.authorId !== null)
  const systemComments = (task.comments || []).filter(c => c.authorId === null)
  const displayedCommentCount = showSystemComments
    ? (task.comments || []).length
    : userComments.length

  const sortedComments = (task.comments || [])
    .filter(comment => showSystemComments || comment.authorId !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  // Fold runs of repeating-task completions into one expandable row
  // (task 59e2dcff). A weekly task otherwise buries every real discussion
  // under an unbroken column of "marked this as complete".
  const commentEntries = foldCompletionStreaks(sortedComments as never)

  // Render a comment using the shared MessageBubble component
  const renderChatBubble = (comment: any, isReply: boolean = false, parentCommentId?: string) => {
    const isCurrentUser = comment.authorId === currentUser.id
    const isSystem = comment.authorId === null
    const isActionsVisible = showingActionsFor === comment.id

    // Build attachments from secureFiles
    const attachments = (comment.secureFiles || []).map((file: any) => ({
      fileId: file.id,
      name: file.originalName,
      type: file.mimeType,
    }))

    // Inline editor replaces the bubble while editing
    if (editingCommentId === comment.id) {
      return (
        <div key={comment.id} className="my-2" data-comment-actions>
          <textarea
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            className="w-full min-h-[80px] p-2 text-sm rounded-md border theme-border theme-bg-secondary theme-text-primary resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex items-center justify-end gap-2 mt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEditingCommentId(null); setEditingText("") }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!editingText.trim()}
              onClick={() => handleEditComment(comment.id, editingText)}
            >
              Save
            </Button>
          </div>
        </div>
      )
    }

    return (
      <MessageBubble
        key={comment.id}
        id={comment.id}
        content={comment.content}
        author={comment.author ? {
          id: comment.author.id,
          name: comment.author.name,
          email: comment.author.email,
          image: comment.author.image,
          isAIAgent: comment.author.isAIAgent,
        } : null}
        isOwnMessage={isCurrentUser}
        createdAt={comment.createdAt}
        attachments={attachments.length > 0 ? attachments : undefined}
        isSystem={isSystem}
        onClick={() => setShowingActionsFor(isActionsVisible ? null : comment.id)}
        actions={isActionsVisible ? (
          <div className="flex items-center gap-3" data-comment-actions>
            <button
              className="flex items-center gap-1 text-xs theme-text-muted hover:theme-text-secondary transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(comment.content || '')
                setShowingActionsFor(null)
              }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>
            {!isReply && (
              <button
                className="flex items-center gap-1 text-xs theme-text-muted hover:theme-text-secondary transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setReplyingTo(comment.id)
                  setShowingActionsFor(null)
                }}
              >
                <Reply className="w-3.5 h-3.5" />
                <span>Reply</span>
              </button>
            )}
            {isCurrentUser && (
              <button
                className="flex items-center gap-1 text-xs theme-text-muted hover:theme-text-secondary transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingCommentId(comment.id)
                  setEditingText(comment.content || '')
                  setShowingActionsFor(null)
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}
            {isCurrentUser && (
              <button
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  if (isReply && parentCommentId) {
                    handleDeleteReply(comment.id, parentCommentId)
                  } else {
                    handleDeleteComment(comment.id)
                  }
                  setShowingActionsFor(null)
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>
        ) : undefined}
      />
    )
  }

  // Mention popup component (reused for both main and reply inputs)
  const canSend = !!(newComment.trim() || attachedFile)

  return (
    <div className="border-t theme-border pt-4 flex flex-col flex-1 min-h-0">
      <div className="mb-3 flex items-center gap-2">
        <Label className="text-sm theme-text-muted">Comments ({displayedCommentCount})</Label>
        {systemComments.length > 0 && (
          <button
            onClick={() => setShowSystemComments(!showSystemComments)}
            className="text-xs theme-text-muted hover:theme-text-secondary transition-colors"
            title={showSystemComments ? "Hide system comments" : "Show system comments"}
          >
            {showSystemComments ? "Hide system" : "Show system"}
          </button>
        )}
        {/* Desktop refresh button */}
        {!isMobileDevice() && onRefreshComments && (
          <button
            onClick={handleDesktopRefresh}
            disabled={isRefreshingDesktop}
            className="ml-auto text-xs theme-text-muted hover:theme-text-secondary transition-colors flex items-center gap-1"
            title="Refresh comments"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshingDesktop ? 'animate-spin' : ''}`} />
            {isRefreshingDesktop ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Pull-to-refresh indicator */}
      {isMobileDevice() && (isPulling || isRefreshing) && (
        <div
          className="flex items-center justify-center py-2 transition-opacity duration-200"
          style={{
            opacity: isRefreshing ? 1 : Math.min(pullDistance / 60, 1),
            height: isRefreshing ? '40px' : `${Math.min(pullDistance / 2, 40)}px`
          }}
        >
          {isRefreshing ? (
            <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
          ) : canRefresh ? (
            <span className="text-sm theme-text-muted">Release to refresh...</span>
          ) : (
            <span className="text-sm theme-text-muted">Pull to refresh...</span>
          )}
        </div>
      )}

      {/* Chat-style comments list */}
      <div
        ref={(el) => {
          commentsContainerRef.current = el
          bindToElement(el)
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="flex-1 overflow-y-auto scrollbar-hide space-y-4 pr-2 mb-4"
      >
        {commentEntries.map((entry) => {
          if (entry.kind === 'streak') {
            return (
              <StreakRow
                key={`streak-${entry.comments[0].id}`}
                entry={entry}
                renderComment={renderChatBubble as never}
              />
            )
          }
          const comment = entry.comment as any
          return (
          <div key={comment.id}>
            {renderChatBubble(comment)}

            {/* Replies as nested bubbles */}
            {comment.replies && comment.replies.length > 0 && (
              <div className={`mt-2 space-y-2 ${
                comment.authorId === currentUser.id ? 'pr-10' : 'pl-10'
              }`}>
                {comment.replies.map((reply: any) => (
                  <div key={reply.id}>
                    {renderChatBubble(reply, true, comment.id)}
                  </div>
                ))}
              </div>
            )}

            {/* Reply input (inline, below the comment) */}
            {replyingTo === comment.id && (
              <div className={`mt-2 ${comment.authorId === currentUser.id ? 'pr-10' : 'pl-10'}`}>
                <div className="text-xs text-blue-400 mb-2">
                  Replying to {getAuthorDisplay(comment.author)}
                  <button
                    onClick={() => {
                      setReplyingTo(null)
                      setReplyContent("")
                      setReplyAttachedFile(null)
                    }}
                    className="ml-2 theme-text-muted hover:theme-text-secondary"
                  >
                    <X className="w-3 h-3 inline" />
                  </button>
                </div>

                {/* Reply input bar — same RichTextInput + mention UX as the main input (Stage 12b) */}
                <RichTextInput
                  value={replyContent}
                  onChange={setReplyContent}
                  onSend={() => handleAddReply(comment.id)}
                  mentionableUsers={mentionableUsers}
                  currentUserId={currentUser.id}
                  lists={availableLists}
                  tasks={availableTasks}
                  placeholder="Write a reply..."
                  enableAttachments
                  uploadContext={{ taskId: task.id }}
                  attachedFile={replyAttachedFile}
                  onAttachedFileChange={setReplyAttachedFile}
                  uploadError={replyUploadErrorState}
                  onUploadErrorChange={setReplyUploadErrorState}
                />
              </div>
            )}
          </div>
          )
        })}
        {agentTyping?.isTyping && (
          <div className="flex items-center gap-2 px-1 py-2">
            <div className="flex items-center gap-0.5 h-5">
              <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-xs theme-text-muted">
              {agentTyping.agentName || 'Agent'} is thinking...
            </span>
          </div>
        )}
      </div>

      {/* Messaging-style input bar - hidden when hideInput is true (rendered outside scroll area) */}
      {!hideInput && (
      <div className="border-t theme-border mt-auto">
        {/* Rich text input bar with @mention autocomplete and highlight overlay */}
        {!readOnly && (
          <div className="px-3 py-3">
            <RichTextInput
              value={newComment}
              onChange={setNewComment}
              onSend={handleAddComment}
              mentionableUsers={mentionableUsers}
              currentUserId={currentUser.id}
              lists={availableLists}
              tasks={availableTasks}
              placeholder="Add a comment..."
              enableAttachments
              uploadContext={{ taskId: task.id }}
              attachedFile={attachedFile}
              onAttachedFileChange={setAttachedFile}
              uploadError={uploadError}
              onUploadErrorChange={setUploadError}
            />
          </div>
        )}
      </div>
      )}
    </div>
  )
}

