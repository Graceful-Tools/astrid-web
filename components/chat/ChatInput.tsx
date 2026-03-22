"use client"

import React, { useState, useRef, useCallback } from 'react'
import { Send } from 'lucide-react'
import { useChatMentions } from '@/hooks/use-chat-mentions'
import type { User } from '@/types/task'

interface ChatInputProps {
  onSend: (content: string) => Promise<void>
  mentionableUsers: User[]
  currentUserId: string
  disabled?: boolean
}

export const ChatInput = React.memo(function ChatInput({
  onSend,
  mentionableUsers,
  currentUserId,
  disabled = false,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const {
    mentionSearch,
    filteredMentionUsers,
    handleTextChange: handleMentionChange,
    insertMention,
    clearMention,
  } = useChatMentions({ mentionableUsers, currentUserId })

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setText(value)
    handleMentionChange(value, e.target.selectionStart)
  }, [handleMentionChange])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isSending || disabled) return

    setIsSending(true)
    try {
      await onSend(trimmed)
      setText('')
      clearMention()
      // Auto-resize textarea back to default
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch {
      // Error handled in hook
    } finally {
      setIsSending(false)
    }
  }, [text, isSending, disabled, onSend, clearMention])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      clearMention()
    }
  }, [handleSend, clearMention])

  const handleMentionSelect = useCallback((user: User) => {
    const { newText, newCursorPos } = insertMention(user, text)
    setText(newText)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }, [insertMention, text])

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [])

  return (
    <div className="relative border-t theme-border px-3 py-2">
      {/* Mention autocomplete dropdown */}
      {mentionSearch !== null && filteredMentionUsers.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 theme-bg-primary border theme-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-10">
          {filteredMentionUsers.map(user => (
            <button
              key={user.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-2"
              onClick={() => handleMentionSelect(user)}
            >
              {user.image ? (
                <img src={user.image} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-[10px] font-medium">
                  {(user.name || user.email)[0]?.toUpperCase()}
                </div>
              )}
              <span className="font-medium">{user.name || user.email}</span>
              {user.isAIAgent && (
                <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1 rounded">AI</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-xl px-3 py-2 text-sm theme-bg-secondary theme-text-primary border-0 outline-none focus:ring-1 focus:ring-blue-500 scrollbar-hide"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isSending || disabled}
          className="flex-shrink-0 p-2 rounded-full bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
})
