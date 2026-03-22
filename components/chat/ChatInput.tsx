"use client"

import React, { useState, useCallback } from 'react'
import { RichTextInput } from '@/components/shared/RichTextInput'
import type { FileAttachment } from '@/components/shared/FileUploadButton'
import type { User, TaskList, Task } from '@/types/task'

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
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed && !attachedFile) return
    if (isSending || disabled) return

    setIsSending(true)
    try {
      // Extract fileId from secure file URL (e.g. /api/secure-files/abc123 → abc123)
      const fileId = attachedFile?.url?.match(/\/api\/secure-files\/([^/?]+)/)?.[1]
      const options = attachedFile
        ? fileId
          ? {
              // Secure file: use fileId only, skip legacy attachment fields to avoid duplicates
              type: 'ATTACHMENT' as const,
              fileId,
            }
          : {
              // Legacy attachment: use URL fields
              type: 'ATTACHMENT' as const,
              attachmentUrl: attachedFile.url,
              attachmentName: attachedFile.name,
              attachmentType: attachedFile.type,
              attachmentSize: attachedFile.size,
            }
        : undefined

      await onSend(trimmed || (attachedFile ? `Attached: ${attachedFile.name}` : ''), options)
      setText('')
      setAttachedFile(null)
    } catch {
      // Error handled in hook
    } finally {
      setIsSending(false)
    }
  }, [text, attachedFile, isSending, disabled, onSend])

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
        attachedFile={attachedFile}
        onAttachedFileChange={setAttachedFile}
        uploadError={uploadError}
        onUploadErrorChange={setUploadError}
        placeholder="Message list..."
        disabled={disabled}
        isSending={isSending}
      />
    </div>
  )
})
