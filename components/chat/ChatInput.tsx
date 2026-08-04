"use client"

import React, { useState, useCallback } from 'react'
import { RichTextInput } from '@/components/shared/RichTextInput'
import type { FileAttachment } from '@/components/shared/FileUploadButton'
import type { User, TaskList, Task } from '@/types/task'
import { commentDrafts } from '@/lib/comment-attachments'

interface ChatInputProps {
  onSend: (content: string, options?: {
    type?: 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'
    attachmentUrl?: string
    attachmentName?: string
    attachmentType?: string
    attachmentSize?: number
    fileId?: string
  }) => Promise<void>
  mentionableUsers: User[]
  currentUserId: string
  lists?: TaskList[]
  tasks?: Task[]
  selectedListId?: string
  /** listId for file upload context (secure upload needs a resource context) */
  listId?: string | null
  /** channelId fallback for upload context when listId is unavailable (e.g. My Tasks) */
  channelId?: string | null
  disabled?: boolean
}

export const ChatInput = React.memo(function ChatInput({
  onSend,
  mentionableUsers,
  currentUserId,
  lists = [],
  tasks = [],
  selectedListId,
  listId,
  channelId,
  disabled = false,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleSend = useCallback(async () => {
    // One message per staged file — the chat API carries a single attachment,
    // so multi-select fans out the way comments do (Task 9f325964).
    const drafts = commentDrafts(text, attachedFiles)
    if (drafts.length === 0) return
    if (isSending || disabled) return

    setIsSending(true)
    try {
      for (const [index, draft] of drafts.entries()) {
        const file = attachedFiles[index]
        const options = file
          ? draft.fileId
            ? {
                // Secure file: use fileId only, skip legacy attachment fields to avoid duplicates
                type: 'ATTACHMENT' as const,
                fileId: draft.fileId,
              }
            : {
                // Legacy attachment: use URL fields
                type: 'ATTACHMENT' as const,
                attachmentUrl: file.url,
                attachmentName: file.name,
                attachmentType: file.type,
                attachmentSize: file.size,
              }
          : undefined

        await onSend(draft.content, options)
      }
      setText('')
      setAttachedFiles([])
    } catch {
      // Error handled in hook
    } finally {
      setIsSending(false)
    }
  }, [text, attachedFiles, isSending, disabled, onSend])

  // Upload context for secure file uploads — use listId if available, fall back to channelId
  const uploadContext: Record<string, string> | undefined = listId ? { listId } : channelId ? { channelId } : undefined

  return (
    <div className="border-t theme-border px-3 py-3">
      <RichTextInput
        value={text}
        onChange={setText}
        onSend={handleSend}
        mentionableUsers={mentionableUsers}
        currentUserId={currentUserId}
        lists={lists}
        tasks={tasks}
        selectedListId={selectedListId}
        enableAttachments
        uploadContext={uploadContext}
        attachedFiles={attachedFiles}
        onAttachedFilesChange={setAttachedFiles}
        uploadError={uploadError}
        onUploadErrorChange={setUploadError}
        placeholder="Message list..."
        disabled={disabled}
        isSending={isSending}
      />
    </div>
  )
})
