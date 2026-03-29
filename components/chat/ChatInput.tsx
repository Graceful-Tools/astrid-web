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
  }) => Promise<void>
  mentionableUsers: User[]
  currentUserId: string
  lists?: TaskList[]
  tasks?: Task[]
  selectedListId?: string
  /** listId for file upload context (secure upload needs a resource context) */
  listId?: string | null
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
      const options = attachedFile
        ? {
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

  // Upload context for secure file uploads — requires a real listId
  const uploadContext = listId ? { listId } : undefined

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
