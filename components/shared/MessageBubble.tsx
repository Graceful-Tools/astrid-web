"use client"

import React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SecureAttachmentViewer } from '@/components/secure-attachment-viewer'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { FileText } from 'lucide-react'
import { format } from 'date-fns'

export interface MessageBubbleAuthor {
  id: string
  name?: string | null
  email?: string
  image?: string | null
  isAIAgent?: boolean
}

export interface MessageBubbleAttachment {
  /** Secure file ID (from SecureFile table) */
  fileId?: string
  /** Direct URL (for legacy/chat attachments) */
  url?: string
  name?: string
  type?: string
}

export interface MessageBubbleProps {
  /** Unique message ID */
  id: string
  /** Message content (rendered as markdown) */
  content?: string
  /** Author info */
  author?: MessageBubbleAuthor | null
  /** Whether the current user sent this message */
  isOwnMessage: boolean
  /** Timestamp */
  createdAt: Date | string
  /** Attachments */
  attachments?: MessageBubbleAttachment[]
  /** Whether this is a system/automated message (centered, no bubble) */
  isSystem?: boolean
  /** Whether this is an optimistic/pending message */
  isOptimistic?: boolean
  /** Markdown code class override */
  codeClass?: string
  /** Action buttons (rendered below the bubble) */
  actions?: React.ReactNode
  /** Click handler for the bubble (e.g., to toggle actions) */
  onClick?: () => void
}

function getInitial(author?: MessageBubbleAuthor | null): string {
  if (!author) return 'S'
  const display = author.name || author.email || '?'
  return display.charAt(0).toUpperCase()
}

function getDisplayName(author?: MessageBubbleAuthor | null, isOwnMessage?: boolean): string {
  if (isOwnMessage) return 'You'
  if (!author) return 'System'
  return author.name || author.email || 'Unknown'
}

/** Extract a secure file ID from a /api/secure-files/{id} URL */
function extractSecureFileId(url: string): string | null {
  const match = url.match(/\/api\/secure-files\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

export const MessageBubble = React.memo(function MessageBubble({
  id,
  content,
  author,
  isOwnMessage,
  createdAt,
  attachments,
  isSystem = false,
  isOptimistic = false,
  codeClass,
  actions,
  onClick,
}: MessageBubbleProps) {
  const timestamp = createdAt instanceof Date ? createdAt : new Date(createdAt)

  // System message: centered muted text, no bubble
  if (isSystem) {
    return (
      <div className="text-xs theme-text-muted text-center py-1">
        On {format(timestamp, "MMM d 'at' h:mm a")}, {content}
      </div>
    )
  }

  const isAgent = author?.isAIAgent

  return (
    <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
      {/* Bubble row: avatar + bubble */}
      <div
        className={`chat-bubble-row ${isOwnMessage ? 'chat-bubble-row-mine' : ''} ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
      >
        {/* Avatar */}
        <Avatar className="h-8 w-8 flex-shrink-0">
          <AvatarImage src={author?.image || undefined} />
          <AvatarFallback>{getInitial(author)}</AvatarFallback>
        </Avatar>

        {/* Bubble */}
        <div
          className={`chat-bubble ${isOwnMessage ? 'chat-bubble-mine' : 'chat-bubble-other'} ${isOptimistic ? 'opacity-60' : ''}`}
        >
          {/* Attachments */}
          {attachments && attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-1">
              {attachments.map((att, i) => {
                const secureId = att.fileId || (att.url ? extractSecureFileId(att.url) : null)
                if (secureId) {
                  return (
                    <SecureAttachmentViewer
                      key={secureId}
                      fileId={secureId}
                      fileName={att.name}
                      showFileName={false}
                    />
                  )
                }
                if (att.url && att.type?.startsWith('image/')) {
                  return (
                    <img
                      key={i}
                      src={att.url}
                      alt={att.name || 'Attachment'}
                      className="max-w-full rounded-lg max-h-48 object-cover"
                    />
                  )
                }
                if (att.url) {
                  return (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs underline text-blue-600 dark:text-blue-400"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {att.name || 'Download attachment'}
                    </a>
                  )
                }
                return null
              })}
            </div>
          )}

          {/* Text content */}
          {content && !content.startsWith('Attached: ') && (
            <div
              className="text-sm theme-text-secondary"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownWithLinks(content, { codeClass: codeClass || 'theme-bg-tertiary px-1 rounded' }),
              }}
            />
          )}
        </div>
      </div>

      {/* Meta: "Author · time" below bubble */}
      <div className={`chat-bubble-meta theme-text-muted ${isOwnMessage ? 'pr-10' : 'pl-10'}`}>
        <span>{getDisplayName(author, isOwnMessage)}</span>
        <span>·</span>
        <span>{format(timestamp, "MMM d 'at' h:mm a")}</span>
      </div>

      {/* Actions slot */}
      {actions && (
        <div className={`mt-1 ${isOwnMessage ? 'pr-10' : 'pl-10'}`}>
          {actions}
        </div>
      )}
    </div>
  )
})
