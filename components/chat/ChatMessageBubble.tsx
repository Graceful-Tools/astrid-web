"use client"

import React from 'react'
import type { ChatMessage } from '@/types/chat'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { Bot, FileText } from 'lucide-react'
import { SecureAttachmentViewer } from '@/components/secure-attachment-viewer'

interface ChatMessageBubbleProps {
  message: ChatMessage
  isOwnMessage: boolean
  showAuthor: boolean
}

/** Extract a secure file ID from a /api/secure-files/{id} URL */
function extractSecureFileId(url: string): string | null {
  const match = url.match(/\/api\/secure-files\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  isOwnMessage,
  showAuthor,
}: ChatMessageBubbleProps) {
  const isOptimistic = message.id.startsWith('optimistic_')
  const isAgent = message.author?.isAIAgent

  const timeStr = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const secureFileId = message.attachmentUrl ? extractSecureFileId(message.attachmentUrl) : null

  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} ${showAuthor ? 'mt-3' : 'mt-0.5'}`}>
      <div className={`max-w-[85%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        {/* Author name */}
        {showAuthor && !isOwnMessage && (
          <div className="flex items-center gap-1 mb-0.5 px-1">
            {isAgent && (
              message.author?.image
                ? <img src={message.author.image} alt="" className="w-3.5 h-3.5 rounded-full" />
                : <Bot className="w-3 h-3 text-purple-500" />
            )}
            <span className={`text-xs font-medium ${isAgent ? 'text-purple-600 dark:text-purple-400' : 'theme-text-muted'}`}>
              {message.author?.name || message.author?.email || 'Unknown'}
            </span>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-2xl px-3 py-1.5 text-sm break-words ${
            isOwnMessage
              ? 'bg-blue-600 text-white rounded-br-md'
              : isAgent
                ? 'bg-purple-100 dark:bg-purple-900/30 theme-text-primary rounded-bl-md'
                : 'theme-bg-secondary theme-text-primary rounded-bl-md'
          } ${isOptimistic ? 'opacity-60' : ''}`}
        >
          {/* Attachment */}
          {message.attachmentUrl && (
            <div className="mb-1">
              {secureFileId ? (
                // Secure file — use viewer for images, show file info for others
                <SecureAttachmentViewer
                  fileId={secureFileId}
                  fileName={message.attachmentName || undefined}
                  showFileName
                />
              ) : message.attachmentType?.startsWith('image/') ? (
                <img
                  src={message.attachmentUrl}
                  alt={message.attachmentName || 'Attachment'}
                  className="max-w-full rounded-lg max-h-48 object-cover"
                />
              ) : (
                <a
                  href={message.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 text-xs underline ${isOwnMessage ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'}`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {message.attachmentName || 'Download attachment'}
                </a>
              )}
            </div>
          )}

          {/* Content */}
          {message.content && (
            <div
              className="chat-message-content"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLinks(message.content),
              }}
            />
          )}
        </div>

        {/* Timestamp */}
        <div className={`text-[10px] theme-text-muted px-1 mt-0.5 ${isOwnMessage ? 'text-right' : 'text-left'}`}>
          {timeStr}
        </div>
      </div>
    </div>
  )
})
