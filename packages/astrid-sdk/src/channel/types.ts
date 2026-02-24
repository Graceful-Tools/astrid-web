/** Astrid channel plugin configuration */
export interface AstridChannelConfig {
  enabled: boolean
  clientId: string
  clientSecret: string
  apiBase?: string
  tokenEndpoint?: string
  sseEndpoint?: string
  agentEmail?: string
  lists?: string[]
  pollIntervalMs?: number
}

/** Task as returned by the agent protocol */
export interface AgentTask {
  id: string
  title: string
  description: string
  priority: number
  completed: boolean
  dueDateTime: string | null
  isAllDay: boolean
  listId: string | null
  listName: string | null
  listDescription: string | null
  assignerName: string | null
  assignerId: string | null
  comments: AgentComment[]
  createdAt: string
  updatedAt: string
}

/** Comment as returned by the agent protocol */
export interface AgentComment {
  id: string
  content: string
  authorName: string | null
  authorId: string
  isAgent: boolean
  createdAt: string
}

/** SSE event from the agent events endpoint */
export interface AgentSSEEvent {
  id?: string
  type: string
  data: {
    taskId: string
    task?: AgentTask
    comment?: AgentComment
    changes?: Record<string, { from: unknown; to: unknown }>
    [key: string]: unknown
  }
}

/** Inbound message to OpenClaw */
export interface InboundMessage {
  content: string
  sessionKey: string
  metadata?: Record<string, unknown>
}

/** Outbound message from OpenClaw */
export interface OutboundMessage {
  content: string
  sessionKey: string
}
