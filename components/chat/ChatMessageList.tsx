"use client"

import React, { useRef, useEffect, useCallback } from 'react'
import { ChatMessageBubble } from './ChatMessageBubble'
import { Loader2 } from 'lucide-react'
import type { ChatMessage } from '@/types/chat'

interface ChatMessageListProps {
  messages: ChatMessage[]
  currentUserId: string
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
}

export const ChatMessageList = React.memo(function ChatMessageList({
  messages,
  currentUserId,
  isLoading,
  hasMore,
  onLoadMore,
}: ChatMessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)

  // Check if scrolled to bottom
  const checkIfAtBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const newCount = messages.length
    const isNewMessage = newCount > prevMessageCountRef.current
    prevMessageCountRef.current = newCount

    if (isNewMessage && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length])

  // Initial scroll to bottom
  useEffect(() => {
    const el = scrollContainerRef.current
    if (el && messages.length > 0) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll handler for loading more
  const handleScroll = useCallback(() => {
    checkIfAtBottom()
    const el = scrollContainerRef.current
    if (!el) return

    // Load more when scrolled near top
    if (el.scrollTop < 100 && hasMore && !isLoading) {
      const prevScrollHeight = el.scrollHeight
      onLoadMore()
      // Preserve scroll position after prepending
      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight - prevScrollHeight
        }
      })
    }
  }, [hasMore, isLoading, onLoadMore, checkIfAtBottom])

  // Group consecutive messages by the same author
  const shouldShowAuthor = (index: number): boolean => {
    if (index === 0) return true
    const prev = messages[index - 1]
    const curr = messages[index]
    if (prev.authorId !== curr.authorId) return true
    // Show author if more than 5 minutes gap
    const gap = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime()
    return gap > 5 * 60 * 1000
  }

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide"
      onScroll={handleScroll}
    >
      {/* Loading indicator for pagination */}
      {isLoading && hasMore && (
        <div className="flex justify-center py-2">
          <Loader2 className="w-4 h-4 animate-spin theme-text-muted" />
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && !isLoading && (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm theme-text-muted">No messages yet. Start the conversation!</p>
        </div>
      )}

      {/* Messages */}
      {messages.map((message, index) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          isOwnMessage={message.authorId === currentUserId}
          showAuthor={shouldShowAuthor(index)}
        />
      ))}
    </div>
  )
})
