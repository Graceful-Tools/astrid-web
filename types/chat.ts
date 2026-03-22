export interface ChatChannel {
  id: string
  listId: string | null
  virtualKey: string | null
  name: string | null
  createdAt: Date
}

export interface ChatMessageAuthor {
  id: string
  name: string | null
  email: string
  image: string | null
  isAIAgent: boolean
  aiAgentType: string | null
}

export interface ChatMessageSecureFile {
  id: string
  originalName: string
  mimeType: string
  fileSize: number
  createdAt: string | Date
}

export interface ChatMessage {
  id: string
  channelId: string
  authorId: string
  author: ChatMessageAuthor
  content: string
  type: 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'
  attachmentUrl?: string | null
  attachmentName?: string | null
  attachmentType?: string | null
  attachmentSize?: number | null
  replyToId?: string | null
  clientRequestId?: string | null
  secureFiles?: ChatMessageSecureFile[]
  createdAt: string
}

export interface ChatMessagesResponse {
  messages: ChatMessage[]
  hasMore: boolean
  nextCursor: string | null
}
