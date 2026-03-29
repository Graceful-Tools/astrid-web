"use client"

import React from 'react'
import { MessageBubble, type MessageBubbleAttachment } from '@/components/shared/MessageBubble'
import type { ChatMessage } from '@/types/chat'

interface ChatMessageBubbleProps {
  message: ChatMessage
  isOwnMessage: boolean
  showAuthor: boolean
}

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  isOwnMessage,
}: ChatMessageBubbleProps) {
  const attachments: MessageBubbleAttachment[] = []
  if (message.attachmentUrl) {
    attachments.push({
      url: message.attachmentUrl,
      name: message.attachmentName || undefined,
      type: message.attachmentType || undefined,
    })
  }

  return (
    <MessageBubble
      id={message.id}
      content={message.content}
      author={message.author ? {
        id: message.author.id,
        name: message.author.name,
        email: message.author.email,
        image: message.author.image,
        isAIAgent: message.author.isAIAgent,
      } : null}
      isOwnMessage={isOwnMessage}
      createdAt={message.createdAt}
      attachments={attachments.length > 0 ? attachments : undefined}
      isOptimistic={message.id.startsWith('optimistic_')}
    />
  )
})
