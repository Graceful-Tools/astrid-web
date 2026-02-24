"use client"

import { useState, useRef, useMemo, useCallback, useEffect } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SecureAttachmentViewer } from "@/components/secure-attachment-viewer"
import { Paperclip, Send, X, Image as ImageIcon, FileText, Loader2, RefreshCw, Copy, Reply, Trash2 } from "lucide-react"
import { format } from "date-fns"
import { isMobileDevice } from "@/lib/layout-detection"
import { renderMarkdownWithLinks } from "@/lib/markdown"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"
import type { Task, User } from "@/types/task"
import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"

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
 * Shared file upload logic for comments and replies.
 * Handles the upload to secure-upload API and returns file attachment data.
 */
async function uploadCommentFile(
  file: File,
  taskId: string,
  setUploading: (value: boolean) => void,
  setAttachedFile: (value: FileAttachment | null) => void,
  setUploadError?: (error: string | null) => void
): Promise<void> {
  // Check file size before upload (100MB limit)
  const maxSize = 100 * 1024 * 1024
  if (file.size > maxSize) {
    const errorMessage = `File size exceeds 100MB limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.`
    if (setUploadError) {
      setUploadError(errorMessage)
    }
    return
  }

  setUploading(true)
  if (setUploadError) {
    setUploadError(null)
  }

  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('context', JSON.stringify({ taskId }))

    const response = await fetch('/api/secure-upload/request-upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error || 'Failed to upload file'

      // Check if error is about file size
      if (errorMessage.includes('100MB') || errorMessage.includes('size')) {
        if (setUploadError) {
          setUploadError('File size exceeds 100MB limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.')
        }
      } else {
        if (setUploadError) {
          setUploadError(errorMessage)
        }
      }
      throw new Error(errorMessage)
    }

    const result = await response.json()
    setAttachedFile({
      url: `/api/secure-files/${result.fileId}`,
      name: result.fileName,
      type: result.mimeType,
      size: result.fileSize
    })
  } catch (error) {
    console.error('Error uploading file:', error)
    if (!setUploadError) {
      // If no error handler provided, show generic message
      alert('Failed to upload file. Please try again.')
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
}

// Props for the standalone input bar component
export interface CommentInputBarProps {
  task: Task
  currentUser: User
  onUpdate: (updatedTask: Task) => void
  onLocalUpdate?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void
  readOnly?: boolean
  newComment: string
  setNewComment: (value: string) => void
  uploadingFile: boolean
  setUploadingFile: (value: boolean) => void
  attachedFile: FileAttachment | null
  setAttachedFile: (value: FileAttachment | null) => void
  uploadError?: string | null
  setUploadError?: (value: string | null) => void
}

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
  setReplyUploadError
}: CommentSectionProps) {
  const [showSystemComments, setShowSystemComments] = useState(false)
  const [localUploadError, setLocalUploadError] = useState<string | null>(null)
  const [localReplyUploadError, setLocalReplyUploadError] = useState<string | null>(null)
  const [isRefreshingDesktop, setIsRefreshingDesktop] = useState(false)
  const commentsContainerRef = useRef<HTMLDivElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const replyInputRef = useRef<HTMLTextAreaElement>(null)

  // Mention state
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0)
  const [isMentioningForReply, setIsMentioningForReply] = useState(false)

  const mentionableUsers = useMemo(() => {
    const users = new Map<string, User>()
    
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
  }, [task, currentUser.id])

  const filteredMentionUsers = useMemo(() => {
    if (!mentionSearch) return mentionableUsers
    const search = mentionSearch.toLowerCase()
    return mentionableUsers.filter(u => 
      (u.name?.toLowerCase().includes(search)) || 
      (u.email.toLowerCase().includes(search))
    )
  }, [mentionableUsers, mentionSearch])

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>, isReply: boolean) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart
    
    if (isReply) {
      setReplyContent(value)
    } else {
      setNewComment(value)
    }

    // Detect @ mention
    const textBeforeCursor = value.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')
    
    if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
      const search = textBeforeCursor.substring(atIndex + 1)
      if (!/\s/.test(search)) {
        setMentionSearch(search)
        setMentionCursorPos(atIndex)
        setIsMentioningForReply(isReply)
        return
      }
    }
    
    setMentionSearch(null)
  }

  const insertMention = (user: User) => {
    const isReply = isMentioningForReply
    const content = isReply ? replyContent : newComment
    const setContent = isReply ? setReplyContent : setNewComment
    const inputRef = isReply ? replyInputRef : commentInputRef

    const textBefore = content.substring(0, mentionCursorPos)
    const textAfter = content.substring(mentionCursorPos + (mentionSearch?.length || 0) + 1)
    
    const mentionText = `@[${user.name || user.email}](${user.id}) `
    const newText = textBefore + mentionText + textAfter
    
    setContent(newText)
    setMentionSearch(null)
    
    // Focus back and set cursor
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        const newPos = mentionCursorPos + mentionText.length
        inputRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

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
    const isOwner = taskList?.ownerId === currentUser.id
    const isAdmin = taskList?.admins?.some(admin => admin.id === currentUser.id) ?? false
    const isMember = taskList?.members?.some(member => member.id === currentUser.id) ?? false
    const isListMember = taskList?.listMembers?.some((lm: any) => lm.userId === currentUser.id) ?? false
    const hasEditPermissions = isOwner || isAdmin || isMember || isListMember

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

  // Inline ChatBubble component for rendering a single comment as a chat bubble
  const renderChatBubble = (comment: any, isReply: boolean = false, parentCommentId?: string) => {
    const isCurrentUser = comment.authorId === currentUser.id
    const isSystem = comment.authorId === null

    // System comment: centered muted text, no bubble
    if (isSystem) {
      return (
        <div className="text-xs theme-text-muted text-center py-1">
          On {format(new Date(comment.createdAt), "MMM d 'at' h:mm a")}, {comment.content}
        </div>
      )
    }

    const isActionsVisible = showingActionsFor === comment.id

    return (
      <div className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'}`}>
        {/* Bubble row: avatar + bubble */}
        <div
          className={`chat-bubble-row ${isCurrentUser ? 'chat-bubble-row-mine' : ''} cursor-pointer`}
          onClick={() => setShowingActionsFor(isActionsVisible ? null : comment.id)}
        >
          {/* Avatar */}
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarImage src={comment.author?.image || undefined} />
            <AvatarFallback>{getAuthorInitial(comment.author)}</AvatarFallback>
          </Avatar>

          {/* Bubble */}
          <div className={`chat-bubble ${isCurrentUser ? 'chat-bubble-mine' : 'chat-bubble-other'}`}>
            {/* Attachments first */}
            {comment.secureFiles && comment.secureFiles.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-1">
                {comment.secureFiles.map((file: any) => (
                  <SecureAttachmentViewer
                    key={file.id}
                    fileId={file.id}
                    fileName={file.originalName}
                    showFileName={false}
                  />
                ))}
              </div>
            )}

            {/* Text content */}
            {comment.content && !comment.content.startsWith('Attached: ') && (
              <div
                className="text-sm theme-text-secondary"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdownWithLinks(comment.content, { codeClass: 'theme-bg-tertiary px-1 rounded' })
                }}
              />
            )}
          </div>
        </div>

        {/* Meta: "Author · time" below bubble */}
        <div className={`chat-bubble-meta theme-text-muted ${isCurrentUser ? 'pr-10' : 'pl-10'}`}>
          <span>{isCurrentUser ? 'You' : getAuthorDisplay(comment.author)}</span>
          <span>·</span>
          <span>{format(new Date(comment.createdAt), "MMM d 'at' h:mm a")}</span>
        </div>

        {/* Action bar: Copy, Reply, Delete - shown on tap */}
        {isActionsVisible && (
          <div className={`flex items-center gap-3 mt-1 ${isCurrentUser ? 'pr-10' : 'pl-10'}`} data-comment-actions>
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
        )}
      </div>
    )
  }

  // Mention popup component (reused for both main and reply inputs)
  const renderMentionPopup = (isForReply: boolean) => {
    if (mentionSearch === null) return null
    if (isForReply && !isMentioningForReply) return null
    if (!isForReply && isMentioningForReply) return null

    return (
      <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border rounded-md shadow-lg z-50 overflow-hidden">
        <div className="p-2 text-xs font-semibold text-muted-foreground border-b bg-muted/50 flex items-center">
          Mention member
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filteredMentionUsers.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">No members found</div>
          ) : (
            filteredMentionUsers.map(user => (
              <button
                key={user.id}
                className="w-full flex items-center px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
                onClick={() => insertMention(user)}
              >
                <Avatar className="h-6 w-6 mr-2">
                  <AvatarImage src={user.image || undefined} />
                  <AvatarFallback>{getAuthorInitial(user)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{user.name || user.email}</span>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

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
        {sortedComments.map((comment) => (
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

                {/* Reply upload error */}
                {replyUploadErrorState && (
                  <div className="mb-2 p-2 bg-red-900/20 border border-red-500/50 rounded">
                    <div className="flex items-start space-x-2">
                      <X className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300 flex-1">{replyUploadErrorState}</p>
                      <button onClick={() => setReplyUploadErrorState(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply file preview */}
                {replyAttachedFile && (
                  <div className="mb-2 p-2 theme-comment-bg rounded theme-border border">
                    <div className="flex items-center space-x-2">
                      {replyAttachedFile.type?.startsWith('image/') ? (
                        <ImageIcon className="w-4 h-4 text-blue-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-green-400" />
                      )}
                      <span className="text-sm theme-text-primary flex-1 truncate">{replyAttachedFile.name}</span>
                      <button onClick={() => setReplyAttachedFile(null)} className="text-red-400 hover:text-red-300">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Reply input bar: [paperclip] [textarea] [send] */}
                <div className="relative">
                  {renderMentionPopup(true)}
                  <div className="chat-input-bar" style={{ boxShadow: 'none', padding: 0 }}>
                    <button
                      onClick={() => document.getElementById(`reply-file-upload-${comment.id}`)?.click()}
                      disabled={uploadingReplyFile}
                      className="theme-text-muted hover:theme-text-secondary transition-colors flex-shrink-0"
                      title={uploadingReplyFile ? 'Uploading...' : 'Attach file'}
                    >
                      <input
                        type="file"
                        id={`reply-file-upload-${comment.id}`}
                        onChange={handleReplyFileUpload}
                        className="hidden"
                        accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
                        disabled={uploadingReplyFile}
                      />
                      {uploadingReplyFile ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Paperclip className="w-5 h-5" />
                      )}
                    </button>

                    <textarea
                      ref={replyInputRef}
                      value={replyContent}
                      onChange={(e) => handleTextChange(e, true)}
                      placeholder="Write a reply..."
                      className="chat-input-textarea theme-comment-bg theme-border theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows={1}
                      style={{ height: 'auto', minHeight: '36px', maxHeight: '200px' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement
                        target.style.height = 'auto'
                        target.style.height = target.scrollHeight + 'px'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (e.shiftKey || e.metaKey || e.ctrlKey) return
                          e.preventDefault()
                          if (replyContent.trim() || replyAttachedFile) {
                            handleAddReply(comment.id)
                          }
                        }
                      }}
                    />

                    <button
                      onClick={() => handleAddReply(comment.id)}
                      disabled={!replyContent.trim() && !replyAttachedFile}
                      className="flex-shrink-0 transition-colors"
                      title="Send reply"
                    >
                      <Send className={`w-5 h-5 ${(replyContent.trim() || replyAttachedFile) ? 'text-blue-500' : 'theme-text-muted'}`} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Messaging-style input bar - hidden when hideInput is true (rendered outside scroll area) */}
      {!hideInput && (
      <div className="border-t theme-border pt-0 mt-auto">
        {/* Upload error */}
        {uploadErrorState && (
          <div className="m-3 mb-0 p-2 bg-red-900/20 border border-red-500/50 rounded-lg">
            <div className="flex items-start space-x-2">
              <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300 flex-1">{uploadErrorState}</p>
              <button onClick={() => setUploadErrorState(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* File attachment preview */}
        {attachedFile && (
          <div className="mx-3 mt-3 p-2 theme-comment-bg rounded theme-border border">
            <div className="flex items-center space-x-2">
              {attachedFile.type?.startsWith('image/') ? (
                <ImageIcon className="w-4 h-4 text-blue-400" />
              ) : (
                <FileText className="w-4 h-4 text-green-400" />
              )}
              <span className="text-sm theme-text-primary flex-1 truncate">{attachedFile.name}</span>
              <button onClick={() => setAttachedFile(null)} className="text-red-400 hover:text-red-300">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Input bar: [paperclip] [textarea] [send] */}
        {!readOnly && (
          <div className="relative">
            {renderMentionPopup(false)}
            <div className="chat-input-bar">
              {/* Paperclip button */}
              <button
                onClick={() => document.getElementById('comment-file-upload')?.click()}
                disabled={uploadingFile}
                className="theme-text-muted hover:theme-text-secondary transition-colors flex-shrink-0"
                title={uploadingFile ? 'Uploading...' : 'Attach file'}
              >
                <input
                  type="file"
                  id="comment-file-upload"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
                  disabled={uploadingFile}
                />
                {uploadingFile ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Paperclip className="w-5 h-5" />
                )}
              </button>

              {/* Expandable textarea */}
              <textarea
                ref={commentInputRef}
                value={newComment}
                onChange={(e) => handleTextChange(e, false)}
                placeholder="Add a comment..."
                className="chat-input-textarea theme-comment-bg theme-border theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={1}
                inputMode="text"
                enterKeyHint="send"
                style={{ height: 'auto', minHeight: '36px', maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = target.scrollHeight + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.shiftKey || e.metaKey || e.ctrlKey) return
                    e.preventDefault()
                    if (newComment.trim() || attachedFile) {
                      handleAddComment()
                    }
                  }
                }}
              />

              {/* Send button */}
              <button
                onClick={handleAddComment}
                disabled={!canSend}
                className="flex-shrink-0 transition-colors"
                title="Send comment"
              >
                <Send className={`w-5 h-5 ${canSend ? 'text-blue-500' : 'theme-text-muted'}`} />
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  )
}

/**
 * Standalone comment input bar component.
 * Rendered outside the scroll area to float at the bottom of the task panel.
 */
export function CommentInputBar({
  task,
  currentUser,
  onUpdate,
  onLocalUpdate,
  readOnly = false,
  newComment,
  setNewComment,
  uploadingFile,
  setUploadingFile,
  attachedFile,
  setAttachedFile,
  uploadError,
  setUploadError,
}: CommentInputBarProps) {
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const [localUploadError, setLocalUploadError] = useState<string | null>(null)

  // Mention state
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0)

  const mentionableUsers = useMemo(() => {
    const users = new Map<string, User>()
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
  }, [task, currentUser.id])

  const filteredMentionUsers = useMemo(() => {
    if (!mentionSearch) return mentionableUsers
    const search = mentionSearch.toLowerCase()
    return mentionableUsers.filter(u =>
      (u.name?.toLowerCase().includes(search)) ||
      (u.email.toLowerCase().includes(search))
    )
  }, [mentionableUsers, mentionSearch])

  const uploadErrorState = uploadError ?? localUploadError
  const setUploadErrorState = setUploadError ?? setLocalUploadError

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursorPos = e.target.selectionStart
    setNewComment(value)

    const textBeforeCursor = value.substring(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')
    if (atIndex !== -1 && (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1]))) {
      const search = textBeforeCursor.substring(atIndex + 1)
      if (!/\s/.test(search)) {
        setMentionSearch(search)
        setMentionCursorPos(atIndex)
        return
      }
    }
    setMentionSearch(null)
  }

  const insertMention = (user: User) => {
    const textBefore = newComment.substring(0, mentionCursorPos)
    const textAfter = newComment.substring(mentionCursorPos + (mentionSearch?.length || 0) + 1)
    const mentionText = `@[${user.name || user.email}](${user.id}) `
    const newText = textBefore + mentionText + textAfter
    setNewComment(newText)
    setMentionSearch(null)
    setTimeout(() => {
      if (commentInputRef.current) {
        commentInputRef.current.focus()
        const newPos = mentionCursorPos + mentionText.length
        commentInputRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

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

    const originalComment = newComment
    const originalFile = attachedFile
    setNewComment("")
    setAttachedFile(null)

    const taskList = task.lists?.[0]
    const isCollaborativePublic = taskList?.privacy === 'PUBLIC' && taskList?.publicListType === 'collaborative'
    const isOwner = taskList?.ownerId === currentUser.id
    const isAdmin = taskList?.admins?.some(admin => admin.id === currentUser.id) ?? false
    const isMember = taskList?.members?.some(member => member.id === currentUser.id) ?? false
    const isListMember = taskList?.listMembers?.some((lm: any) => lm.userId === currentUser.id) ?? false
    const hasEditPermissions = isOwner || isAdmin || isMember || isListMember
    const shouldSkipOptimisticUpdate = isCollaborativePublic && !hasEditPermissions

    if (!shouldSkipOptimisticUpdate) {
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return { ...currentTask, comments: [...(currentTask.comments || []), optimisticComment as any] }
        })
      } else {
        onUpdate({ ...task, comments: [...(task.comments || []), optimisticComment as any] })
      }
    }

    try {
      if (isOfflineMode()) {
        await OfflineCommentOperations.saveComment(optimisticComment as any)
        await OfflineSyncManager.queueMutation('create', 'comment', tempId, `/api/tasks/${task.id}/comments`, 'POST', commentData, task.id)
        return
      }

      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(commentData),
      })

      if (!response.ok) throw new Error('Failed to add comment')
      const serverComment = await response.json()
      await OfflineCommentOperations.saveComment(serverComment)

      if (!shouldSkipOptimisticUpdate) {
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return { ...currentTask, comments: (currentTask.comments || []).map(c => c.id === tempId ? serverComment : c) }
          })
        } else {
          onUpdate({ ...task, comments: (task.comments || []).map(c => c.id === tempId ? serverComment : c) })
        }
      } else {
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return { ...currentTask, comments: [...(currentTask.comments || []), serverComment] }
          })
        }
      }
    } catch (error) {
      console.error("Error adding comment:", error)
      if (!shouldSkipOptimisticUpdate) {
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return { ...currentTask, comments: (currentTask.comments || []).filter(c => c.id !== tempId) }
          })
        } else {
          onUpdate({ ...task, comments: (task.comments || []).filter(c => c.id !== tempId) })
        }
      }
      setNewComment(originalComment)
      setAttachedFile(originalFile)
    }
  }

  const canSend = !!(newComment.trim() || attachedFile)

  if (readOnly) return null

  return (
    <div className="border-t theme-border pt-0">
      {/* Upload error */}
      {uploadErrorState && (
        <div className="m-3 mb-0 p-2 bg-red-900/20 border border-red-500/50 rounded-lg">
          <div className="flex items-start space-x-2">
            <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300 flex-1">{uploadErrorState}</p>
            <button onClick={() => setUploadErrorState(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* File attachment preview */}
      {attachedFile && (
        <div className="mx-3 mt-3 p-2 theme-comment-bg rounded theme-border border">
          <div className="flex items-center space-x-2">
            {attachedFile.type?.startsWith('image/') ? (
              <ImageIcon className="w-4 h-4 text-blue-400" />
            ) : (
              <FileText className="w-4 h-4 text-green-400" />
            )}
            <span className="text-sm theme-text-primary flex-1 truncate">{attachedFile.name}</span>
            <button onClick={() => setAttachedFile(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Input bar: [paperclip] [textarea] [send] */}
      <div className="relative">
        {mentionSearch !== null && (
          <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border rounded-md shadow-lg z-50 overflow-hidden">
            <div className="p-2 text-xs font-semibold text-muted-foreground border-b bg-muted/50 flex items-center">
              Mention member
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredMentionUsers.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No members found</div>
              ) : (
                filteredMentionUsers.map(user => (
                  <button
                    key={user.id}
                    className="w-full flex items-center px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
                    onClick={() => insertMention(user)}
                  >
                    <Avatar className="h-6 w-6 mr-2">
                      <AvatarImage src={user.image || undefined} />
                      <AvatarFallback>{getAuthorInitial(user)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{user.name || user.email}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        <div className="chat-input-bar">
          <button
            onClick={() => document.getElementById('comment-file-upload-bar')?.click()}
            disabled={uploadingFile}
            className="theme-text-muted hover:theme-text-secondary transition-colors flex-shrink-0"
            title={uploadingFile ? 'Uploading...' : 'Attach file'}
          >
            <input
              type="file"
              id="comment-file-upload-bar"
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
              disabled={uploadingFile}
            />
            {uploadingFile ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </button>

          <textarea
            ref={commentInputRef}
            value={newComment}
            onChange={handleTextChange}
            placeholder="Add a comment..."
            className="chat-input-textarea theme-comment-bg theme-border theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={1}
            inputMode="text"
            enterKeyHint="send"
            style={{ height: 'auto', minHeight: '36px', maxHeight: '200px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = target.scrollHeight + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey || e.metaKey || e.ctrlKey) return
                e.preventDefault()
                if (newComment.trim() || attachedFile) {
                  handleAddComment()
                }
              }
            }}
          />

          <button
            onClick={handleAddComment}
            disabled={!canSend}
            className="flex-shrink-0 transition-colors"
            title="Send comment"
          >
            <Send className={`w-5 h-5 ${canSend ? 'text-blue-500' : 'theme-text-muted'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}
