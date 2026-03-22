"use client"

import React from 'react'
import { ChatMessageList } from './ChatMessageList'
import { ChatInput } from './ChatInput'
import { useChatChannel } from '@/hooks/use-chat-channel'
import { Loader2 } from 'lucide-react'
import type { User } from '@/types/task'

interface ChatPanelProps {
  channelId: string | null
  currentUser: { id: string; name?: string | null; email: string; image?: string | null }
  listMembers: User[]
  isLoading?: boolean
  className?: string
}

export const ChatPanel = React.memo(function ChatPanel({
  channelId,
  currentUser,
  listMembers,
  isLoading: externalLoading,
  className = '',
}: ChatPanelProps) {
  const {
    messages,
    isLoading: messagesLoading,
    hasMore,
    error,
    sendMessage,
    loadMore,
  } = useChatChannel({
    channelId,
    currentUserId: currentUser.id,
    enabled: !!channelId,
  })

  if (externalLoading || (!channelId && !error)) {
    return (
      <div className={`flex flex-col h-full items-center justify-center ${className}`}>
        <Loader2 className="w-5 h-5 animate-spin theme-text-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex flex-col h-full items-center justify-center ${className}`}>
        <p className="text-sm text-red-500">Failed to load chat</p>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <ChatMessageList
        messages={messages}
        currentUserId={currentUser.id}
        isLoading={messagesLoading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
      <ChatInput
        onSend={sendMessage}
        mentionableUsers={listMembers}
        currentUserId={currentUser.id}
      />
    </div>
  )
})
