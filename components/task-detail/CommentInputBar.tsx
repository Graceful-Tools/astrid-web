"use client"

import { useState, useMemo, useEffect } from "react"
import { RichTextInput } from "@/components/shared/RichTextInput"
import type { Task, User } from "@/types/task"
import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"
import { hasExplicitListRole } from "@/lib/list-permissions"

export interface CommentInputBarProps {
  task: Task
  currentUser: User
  onUpdate: (updatedTask: Task) => void
  onLocalUpdate?: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void
  readOnly?: boolean
  /** Lists for # autocomplete */
  lists?: import("@/types/task").TaskList[]
  /** Tasks for ! autocomplete */
  tasks?: Task[]
  newComment: string
  setNewComment: (value: string) => void
  uploadingFile: boolean
  setUploadingFile: (value: boolean) => void
  attachedFile: FileAttachment | null
  setAttachedFile: (value: FileAttachment | null) => void
  uploadError?: string | null
  setUploadError?: (value: string | null) => void
  /** Show a timer button in the send slot while the input is empty */
  onTimerClick?: () => void
}

/**
 * Standalone comment input bar — RichTextInput wrapper with optimistic
 * comment posting + offline sync fallback.
 *
 * Extracted from components/task-detail/CommentSection.tsx (Stage 12c).
 * The mentions / attachments UI is owned by RichTextInput; this component
 * is just the optimistic-update + fetch + offline-queue orchestration.
 */
export function CommentInputBar({
  task,
  currentUser,
  onUpdate,
  onLocalUpdate,
  readOnly = false,
  lists: availableLists,
  tasks: availableTasks,
  newComment,
  setNewComment,
  attachedFile,
  setAttachedFile,
  uploadError,
  setUploadError,
  onTimerClick,
}: CommentInputBarProps) {
  // Fetch Astrid agent so it's available in the @-mention list.
  const [defaultAgent, setDefaultAgent] = useState<User | null>(null)
  useEffect(() => {
    fetch("/api/user/available-agents")
      .then(r => r.json())
      .then(data => {
        const astrid = (data.agents || []).find((a: { email: string }) => a.email === "astrid@astrid.cc")
        if (astrid) {
          setDefaultAgent({
            id: astrid.id,
            name: astrid.name,
            email: astrid.email,
            image: astrid.image,
            createdAt: new Date(),
            isAIAgent: true,
          })
        }
      })
      .catch(() => {})
  }, [])

  const mentionableUsers = useMemo(() => {
    const users = new Map<string, User>()
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

  const handleAddComment = async () => {
    if (!newComment.trim() && !attachedFile) return

    const { nanoid } = await import("nanoid")
    const { OfflineSyncManager, isOfflineMode } = await import("@/lib/offline-sync")
    const { OfflineCommentOperations } = await import("@/lib/offline-db")

    const tempId = `temp-${nanoid()}`
    const commentData = {
      content: newComment.trim() || (attachedFile ? `Attached: ${attachedFile.name}` : ""),
      type: attachedFile ? ("ATTACHMENT" as const) : ("TEXT" as const),
      fileId: attachedFile ? attachedFile.url.split("/").pop() : undefined,
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
      secureFiles: attachedFile
        ? [
            {
              id: commentData.fileId || "temp-file",
              originalName: attachedFile.name,
              mimeType: attachedFile.type || "application/octet-stream",
              fileSize: attachedFile.size || 0,
              uploadedBy: currentUser.id,
              uploadedAt: new Date(),
              commentId: tempId,
            },
          ]
        : [],
    }

    const originalComment = newComment
    const originalFile = attachedFile
    setNewComment("")
    setAttachedFile(null)

    const taskList = task.lists?.[0]
    const isCollaborativePublic = taskList?.privacy === "PUBLIC" && taskList?.publicListType === "collaborative"
    const hasEditPermissions = hasExplicitListRole(currentUser, taskList as never)
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
        await OfflineSyncManager.queueMutation(
          "create",
          "comment",
          tempId,
          `/api/tasks/${task.id}/comments`,
          "POST",
          commentData,
          task.id,
        )
        return
      }

      const response = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(commentData),
      })

      if (!response.ok) throw new Error("Failed to add comment")
      const serverComment = await response.json()
      await OfflineCommentOperations.saveComment(serverComment)

      if (!shouldSkipOptimisticUpdate) {
        if (onLocalUpdate) {
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return {
              ...currentTask,
              comments: (currentTask.comments || []).map(c => (c.id === tempId ? serverComment : c)),
            }
          })
        } else {
          onUpdate({
            ...task,
            comments: (task.comments || []).map(c => (c.id === tempId ? serverComment : c)),
          })
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

  if (readOnly) return null

  return (
    <div className="border-t theme-border px-3 py-3">
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
        onTimerClick={onTimerClick}
      />
    </div>
  )
}
