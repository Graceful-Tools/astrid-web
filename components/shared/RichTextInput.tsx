"use client"

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Send, Hash, CheckCircle2, Circle, Users, Globe, Paperclip, Loader2, X, Image as ImageIcon, FileText } from 'lucide-react'
import { useChatMentions, type AutocompleteItem, type AutocompleteType } from '@/hooks/use-chat-mentions'
import type { User, TaskList, Task } from '@/types/task'
import type { FileAttachment } from '@/components/shared/FileUploadButton'

// ─── Highlight overlay ────────────────────────────────────────────

/** Patterns for @[Name](id), #[Name](id), ![Name](id) */
const REFERENCE_PATTERN = /([@#!])\[([^\]]+)\]\([^)]+\)/g

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildHighlightMarkup(text: string): string {
  const parts: string[] = []
  let lastIndex = 0
  REFERENCE_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeHtml(text.slice(lastIndex, match.index)))
    }
    const trigger = match[1]
    const name = match[2]
    let cls: string
    switch (trigger) {
      case '@':
        cls = 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded px-0.5'
        break
      case '#':
        cls = 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded px-0.5'
        break
      case '!':
        cls = 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded px-0.5'
        break
      default:
        cls = ''
    }
    parts.push(`<span class="${cls}">${trigger}${escapeHtml(name)}</span>`)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)))
  }
  return parts.join('') + '\n'
}

function hasReferences(text: string): boolean {
  REFERENCE_PATTERN.lastIndex = 0
  return REFERENCE_PATTERN.test(text)
}

// ─── Types ────────────────────────────────────────────────────────

export interface RichTextInputProps {
  /** Current text value (controlled) */
  value: string
  /** Called when text changes */
  onChange: (value: string) => void
  /** Called when user submits (Enter or send button) */
  onSend: () => void

  // Autocomplete data
  mentionableUsers?: User[]
  currentUserId: string
  /** Lists for # autocomplete — omit to disable */
  lists?: TaskList[]
  /** Tasks for ! autocomplete — omit to disable */
  tasks?: Task[]
  /** Selected list ID for task sorting priority */
  selectedListId?: string

  // File attachment
  /** Enable file attachment button. Provide uploadContext for secure upload. */
  enableAttachments?: boolean
  /** Upload context passed to /api/secure-upload/request-upload (e.g. { taskId } or { listId }) */
  uploadContext?: Record<string, string>
  /** Current attached file (controlled) */
  attachedFile?: FileAttachment | null
  /** Called when a file is attached or removed */
  onAttachedFileChange?: (file: FileAttachment | null) => void
  /** Upload error message */
  uploadError?: string | null
  /** Called when upload error changes */
  onUploadErrorChange?: (error: string | null) => void

  // UI
  placeholder?: string
  disabled?: boolean
  /** Hide the send button (e.g. for inline comment bars that have their own) */
  hideSendButton?: boolean
  /** Custom class for the wrapper */
  className?: string
  /** Accept file types for upload */
  accept?: string
  /** Whether the input is currently submitting */
  isSending?: boolean
}

// ─── Component ────────────────────────────────────────────────────

export const RichTextInput = React.memo(function RichTextInput({
  value,
  onChange,
  onSend,
  mentionableUsers = [],
  currentUserId,
  lists,
  tasks,
  selectedListId,
  enableAttachments = false,
  uploadContext,
  attachedFile,
  onAttachedFileChange,
  uploadError,
  onUploadErrorChange,
  placeholder = 'Type a message...',
  disabled = false,
  hideSendButton = false,
  className = '',
  accept = 'image/*,video/*,.pdf,.doc,.docx,.txt,.zip',
  isSending = false,
}: RichTextInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const {
    autocompleteType,
    autocompleteItems,
    selectedIndex,
    handleTextChange: handleMentionChange,
    insertAutocompleteItem,
    clearMention,
    selectNext,
    selectPrev,
    selectCurrent,
  } = useChatMentions({ mentionableUsers, currentUserId, lists, tasks, selectedListId })

  const showDropdown = autocompleteType !== null && autocompleteItems.length > 0

  // Highlight overlay
  const highlightHtml = useMemo(() => buildHighlightMarkup(value), [value])
  const showOverlay = hasReferences(value)

  // Scroll sync
  const syncScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [])

  // Scroll selected autocomplete item into view
  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return
    const selected = dropdownRef.current.querySelector('[data-selected="true"]')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, showDropdown])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    onChange(val)
    handleMentionChange(val, e.target.selectionStart)
  }, [onChange, handleMentionChange])

  const handleItemSelect = useCallback((item: AutocompleteItem) => {
    const { newText, newCursorPos } = insertAutocompleteItem(item, value)
    onChange(newText)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }, [insertAutocompleteItem, value, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectNext()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectPrev()
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        const item = selectCurrent()
        if (item) {
          e.preventDefault()
          handleItemSelect(item)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        clearMention()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }, [showDropdown, onSend, clearMention, selectNext, selectPrev, selectCurrent, handleItemSelect])

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, 120)
    el.style.height = h + 'px'
    if (backdropRef.current) {
      backdropRef.current.style.height = h + 'px'
    }
  }, [])

  // File upload
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!uploadContext) {
      onUploadErrorChange?.('File attachments are not available in this view.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const maxSize = 100 * 1024 * 1024
    if (file.size > maxSize) {
      onUploadErrorChange?.('File size exceeds 100MB limit. Please upload large files to a file service and share a link instead.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploading(true)
    onUploadErrorChange?.(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('context', JSON.stringify(uploadContext))

      const response = await fetch('/api/secure-upload/request-upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to upload file')
      }

      const result = await response.json()
      onAttachedFileChange?.({
        url: `/api/secure-files/${result.fileId}`,
        name: result.fileName,
        type: result.mimeType,
        size: result.fileSize,
      })
    } catch (error) {
      console.error('Error uploading file:', error)
      onUploadErrorChange?.(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [uploadContext, onAttachedFileChange, onUploadErrorChange])

  const canSend = !!(value.trim() || attachedFile) && !isSending && !disabled

  return (
    <div className={`relative ${className}`}>
      {/* Autocomplete dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 right-0 mb-1 theme-bg-primary border theme-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-10"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider theme-text-muted border-b theme-border">
            {autocompleteType === 'mention' && 'People'}
            {autocompleteType === 'list' && 'Lists'}
            {autocompleteType === 'task' && 'Tasks'}
          </div>
          {autocompleteItems.map((item, index) => (
            <button
              key={item.id}
              data-selected={index === selectedIndex}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                index === selectedIndex
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}
              onClick={() => handleItemSelect(item)}
            >
              <AutocompleteItemIcon item={item} />
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{item.label}</span>
                {item.secondaryLabel && (
                  <span className="text-[11px] theme-text-muted truncate block">{item.secondaryLabel}</span>
                )}
              </div>
              <AutocompleteItemBadge item={item} />
            </button>
          ))}
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="mx-0 mb-1 p-2 bg-red-900/20 border border-red-500/50 rounded-lg">
          <div className="flex items-start gap-2">
            <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300 flex-1">{uploadError}</p>
            <button onClick={() => onUploadErrorChange?.(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* File attachment preview */}
      {attachedFile && (
        <div className="mb-1 p-2 theme-bg-secondary rounded theme-border border">
          <div className="flex items-center gap-2">
            {attachedFile.type?.startsWith('image/') ? (
              <ImageIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-green-400 flex-shrink-0" />
            )}
            <span className="text-sm theme-text-primary flex-1 truncate">{attachedFile.name}</span>
            <button onClick={() => onAttachedFileChange?.(null)} className="text-red-400 hover:text-red-300 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Input area — all elements use h-9 for consistent vertical alignment */}
      <div className="flex items-center gap-2">
        {/* Paperclip button */}
        {enableAttachments && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept={accept}
              className="hidden"
              disabled={disabled || uploading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              className="flex-shrink-0 h-9 w-9 flex items-center justify-center rounded-full theme-text-muted hover:theme-text-secondary transition-colors"
              title={uploading ? 'Uploading...' : 'Attach file'}
            >
              {uploading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Paperclip className="w-5 h-5" />
              )}
            </button>
          </>
        )}

        {/* Textarea with highlight overlay */}
        <div className="flex-1 relative">
          {showOverlay && (
            <div
              ref={backdropRef}
              aria-hidden
              className="absolute inset-0 rounded-xl px-3 py-2 text-sm leading-5 whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              style={{ maxHeight: '120px' }}
              dangerouslySetInnerHTML={{ __html: highlightHtml }}
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onScroll={syncScroll}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            spellCheck={!showOverlay}
            className={`w-full resize-none rounded-xl px-3 py-2 text-sm leading-5 h-9 theme-bg-secondary border-0 outline-none focus:ring-1 focus:ring-blue-500 scrollbar-hide ${
              showOverlay ? 'text-transparent caret-current' : 'theme-text-primary'
            }`}
            style={{ maxHeight: '120px', caretColor: 'currentColor' }}
          />
        </div>

        {/* Send button */}
        {!hideSendButton && (
          <button
            onClick={onSend}
            disabled={!canSend}
            className="flex-shrink-0 h-9 w-9 flex items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
})

// ─── Autocomplete item rendering ──────────────────────────────────

function AutocompleteItemIcon({ item }: { item: AutocompleteItem }) {
  switch (item.type) {
    case 'mention':
      return item.image ? (
        <img src={item.image} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-[10px] font-medium flex-shrink-0">
          {item.label[0]?.toUpperCase()}
        </div>
      )
    case 'list':
      return <Hash className="w-4 h-4 theme-text-muted flex-shrink-0" />
    case 'task':
      return item.completed
        ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        : <Circle className="w-4 h-4 theme-text-muted flex-shrink-0" />
  }
}

function AutocompleteItemBadge({ item }: { item: AutocompleteItem }) {
  if (item.type === 'mention' && item.isAIAgent) {
    return (
      <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1 rounded flex-shrink-0">
        AI
      </span>
    )
  }
  if (item.type === 'list' && item.isShared) {
    return item.privacy === 'PUBLIC' ? (
      <Globe className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
    ) : (
      <Users className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
    )
  }
  if (item.type === 'task' && item.completed) {
    return (
      <span className="text-[10px] theme-text-muted flex-shrink-0">Done</span>
    )
  }
  return null
}
