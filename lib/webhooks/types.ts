/**
 * Shared types for the webhook notifier modules.
 *
 * Lives in its own module so the comment-notifier and task-assignment-notifier
 * don't need to import from ai-agent-webhook-service.ts (which would be a
 * type-only circular import — TS handles it but it's a smell, and it would
 * trip people who later try to add value imports between the modules).
 *
 * The shape itself is the contract Claude Code Remote and external AI agent
 * webhooks consume — keep it stable.
 */

export interface TaskAssignmentWebhookPayload {
  event: 'task.assigned' | 'task.updated' | 'task.completed' | 'task.commented'
  timestamp: string
  aiAgent: {
    id: string
    name: string
    type: string
    email: string
  }
  task: {
    id: string
    title: string
    description: string
    priority: number
    dueDateTime?: string
    assigneeId: string
    creatorId: string | null
    listId: string
    url: string
  }
  list: {
    id: string
    name: string
    description?: string
    githubRepositoryId?: string
  }
  mcp: {
    baseUrl: string
    operationsEndpoint: string
    accessToken?: string
    availableOperations: string[]
    contextInstructions: string
  }
  creator: {
    id: string | null
    name?: string
    email: string
  }
  /**
   * Who this run is charged to, and why that user was chosen.
   *
   * Recorded on the dispatch rather than re-derived by each consumer so what
   * was charged is auditable after the fact — and so a receiver can tell a run
   * paid for by the list's configured user from one that fell back to the list
   * owner (task 0672b69b).
   */
  billing: {
    userId: string | null
    source: 'list-configured-by' | 'list-owner' | 'task-creator' | 'none'
  }
  comment?: {
    id: string
    content: string
    authorName: string
    authorId: string | null
    createdAt: string
  }
  /** Full comment history for context (used by Claude Code Remote). */
  comments?: Array<{
    id: string
    content: string
    authorName: string
    authorId: string | null
    createdAt: string
  }>
}
