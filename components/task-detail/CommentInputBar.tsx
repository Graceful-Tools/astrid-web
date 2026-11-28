"use client"

import { useTranslations } from '@/lib/i18n/client'
import { BRAND } from '@/lib/brand/config'
import { useState, useMemo, useEffect } from "react"
import { RichTextInput } from "@/components/shared/RichTextInput"
import type { Comment, Task, User } from "@/types/task"
import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"
import { hasExplicitListRole } from "@/lib/list-permissions"
import { buildPendingComments, postPendingComments } from "@/lib/comment-posting"
import { Vote } from "lucide-react"
import { DecisionComposer, type DecisionDestination } from "@/components/task-detail/DecisionComposer"
import { appendDecision } from "@/lib/decision-draft"
import { handBackTarget, handedBackTask, replyThenHandBack } from "@/lib/reply-hand-back"
import { ReplyHandBackButton } from "@/components/task-detail/ReplyHandBackButton"

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
  attachedFiles: FileAttachment[]
  setAttachedFiles: (value: FileAttachment[]) => void
  uploadError?: string | null
  setUploadError?: (value: string | null) => void
  /** Show a timer button in the send slot while the input is empty */
  onTimerClick?: () => void
  /** Whether the decision composer may add to the description (ADEV-240); comments always. */
  canEditDescription?: boolean
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
  attachedFiles,
  setAttachedFiles,
  uploadError,
  setUploadError,
  onTimerClick,
  canEditDescription = false,
}: CommentInputBarProps) {
  const { t } = useTranslations()
  const [composerOpen, setComposerOpen] = useState(false)
  const [handingBack, setHandingBack] = useState(false)
  // Fetch Astrid agent so it's available in the @-mention list.
  const [defaultAgent, setDefaultAgent] = useState<User | null>(null)
  useEffect(() => {
    fetch("/api/v1/users/me/available-agents")
      .then(r => r.json())
      .then(data => {
        const astrid = (data.agents || []).find((a: { email: string }) => a.email === `astrid@${BRAND.agentEmailDomain}`)
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

  const handleAddComment = () => { void postComment(newComment, attachedFiles, true) }

  // ADEV-360: on a task assigned to me, one tap answers whoever asked and hands it back to them.
  const handBack = handBackTarget(task, currentUser.id)
  const hasReply = newComment.trim().length > 0 || attachedFiles.length > 0
  const handleHandBack = async () => {
    if (!handBack || handingBack) return
    setHandingBack(true)
    let posted: Comment[] = []
    try {
      await replyThenHandBack(
        handBack,
        hasReply ? async () => {
          const result = await postComment(newComment, attachedFiles, true)
          posted = result.posted
          return result.ok
        } : null,
        async target => { await onUpdate(handedBackTask(task, target, posted)) },
      )
    } finally {
      setHandingBack(false)
    }
  }

  /**
   * Post a comment optimistically. `fromComposer` is the typed comment: it clears the input and
   * restores it on failure. A decision from the composer (ADEV-240) posts its own text and leaves
   * whatever is half-typed in the input alone.
   */
  const postComment = async (
    text: string,
    files: FileAttachment[],
    fromComposer: boolean,
  ): Promise<{ ok: boolean; posted: Comment[] }> => {
    // One comment per staged file — the comments API takes a single fileId (Task 9f325964).
    const pending = await buildPendingComments({
      taskId: task.id,
      currentUser,
      text,
      files,
    })
    if (pending.length === 0) return { ok: false, posted: [] }

    const originalComment = text
    const originalFiles = files
    if (fromComposer) {
      setNewComment("")
      setAttachedFiles([])
    }

    const taskList = task.lists?.[0]
    const isCollaborativePublic = taskList?.privacy === "PUBLIC" && taskList?.publicListType === "collaborative"
    const hasEditPermissions = hasExplicitListRole(currentUser, taskList as never)
    const shouldSkipOptimisticUpdate = isCollaborativePublic && !hasEditPermissions

    /** Rewrite the task's comment list through whichever update channel this view has. */
    const writeComments = (update: (comments: any[]) => any[]) => {
      if (onLocalUpdate) {
        onLocalUpdate((taskId: string, currentTask: Task) => {
          if (currentTask.id !== task.id) return currentTask
          return { ...currentTask, comments: update(currentTask.comments || []) }
        })
      } else {
        onUpdate({ ...task, comments: update(task.comments || []) })
      }
    }

    if (!shouldSkipOptimisticUpdate) {
      const optimistic = pending.map(p => p.optimistic)
      writeComments(comments => [...comments, ...(optimistic as any[])])
    }

    const fromServer: Comment[] = []
    const ok = await postPendingComments(task.id, pending, originalFiles, originalComment, {
      replace: (tempId, serverComment) => {
        fromServer.push(serverComment)
        if (!shouldSkipOptimisticUpdate) {
          writeComments(comments => comments.map(c => (c.id === tempId ? serverComment : c)))
        } else if (onLocalUpdate) {
          // Non-members never got an optimistic row; append without touching the task PUT.
          onLocalUpdate((taskId: string, currentTask: Task) => {
            if (currentTask.id !== task.id) return currentTask
            return { ...currentTask, comments: [...(currentTask.comments || []), serverComment] }
          })
        }
      },
      remove: tempIds => {
        if (shouldSkipOptimisticUpdate) return
        const unsent = new Set(tempIds)
        writeComments(comments => comments.filter(c => !unsent.has(c.id)))
      },
      restore: (text, files) => {
        if (!fromComposer) return
        if (text !== null) setNewComment(text)
        setAttachedFiles(files)
      },
    })
    // Offline, nothing comes back from the server: the queued optimistic rows stand in.
    return { ok, posted: fromServer.length ? fromServer : (pending.map(p => p.optimistic) as unknown as Comment[]) }
  }

  const postDecision = async (markdown: string, destination: DecisionDestination) => {
    if (destination === 'description') {
      onUpdate({ ...task, description: appendDecision(markdown, task.description || '') })
      return
    }
    await postComment(markdown, [], false)
  }

  if (readOnly) return null

  return (
    <div className="border-t theme-border px-3 py-3">
      {handBack && (
        <ReplyHandBackButton target={handBack} hasReply={hasReply} busy={handingBack} onClick={handleHandBack} />
      )}
      <RichTextInput
        value={newComment}
        onChange={setNewComment}
        onSend={handleAddComment}
        mentionableUsers={mentionableUsers}
        currentUserId={currentUser.id}
        lists={availableLists}
        tasks={availableTasks}
        placeholder={t('tasks.commentsSection.addPlaceholder')}
        enableAttachments
        uploadContext={{ taskId: task.id }}
        attachedFiles={attachedFiles}
        onAttachedFilesChange={setAttachedFiles}
        uploadError={uploadError}
        onUploadErrorChange={setUploadError}
        onTimerClick={onTimerClick}
        leadingActions={
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full theme-text-muted hover:theme-text-secondary transition-colors"
            title={t('tasks.decisionComposer.title')}
            aria-label={t('tasks.decisionComposer.title')}
            data-testid="ask-for-decision"
          >
            <Vote className="w-5 h-5" />
          </button>
        }
      />
      {composerOpen && (
        <DecisionComposer
          open
          onClose={() => setComposerOpen(false)}
          canEditDescription={canEditDescription}
          onPost={postDecision}
        />
      )}
    </div>
  )
}
