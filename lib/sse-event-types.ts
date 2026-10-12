/**
 * Every event `type` the server sends over `/api/sse`.
 *
 * This is a client contract: web, iOS and Windows switch on these strings.
 * `broadcastToUsers` (lib/sse-utils.ts) only accepts a type listed here, so an
 * event cannot reach the wire without an entry, and
 * tests/rules/sse-event-names-match-the-contract.test.ts holds the list in
 * docs/API_CONTRACT.md → *Real-Time Updates* to exactly these keys.
 *
 * The doc once listed `task:created`, `comment:created`, … — names the server
 * never sent (AWTD-1108). Names are snake_case; there is no colon form.
 */
export const SSE_EVENTS = {
  // Connection lifecycle (app/api/sse/route.ts)
  connected: 'Stream opened',
  ping: 'Keep-alive heartbeat',
  reconnect: 'Server is closing the stream; reconnect with `since` to recover missed events',

  // Tasks
  task_created: 'New task created',
  task_updated: 'Task modified',
  task_completed: 'Task modified, and the change completed it (sent instead of `task_updated`)',
  task_deleted: 'Task removed',
  task_assigned: 'Task assigned to the recipient',

  // Comments
  comment_created: 'New comment added',
  comment_updated: 'Comment edited',
  comment_deleted: 'Comment removed',

  // Lists and membership
  list_created: 'New list created',
  list_updated: 'List modified',
  list_deleted: 'List removed',
  list_member_added: 'Member added to a list',
  list_member_removed: 'Member removed from a list',
  list_member_role_changed: 'Member role changed (to anything but admin)',
  list_admin_role_granted: 'Member promoted to admin',

  // Chat
  chat_message_created: 'New chat message',
  chat_message_updated: 'Chat message edited',
  chat_message_deleted: 'Chat message removed',
  chat_mention: 'Recipient was @-mentioned in a chat message',

  // AI agents
  agent_typing_start: 'AI agent began processing (show typing indicator)',
  agent_typing_stop: 'AI agent finished processing (hide typing indicator)',
  agent_task_start: 'A scheduled agent task has started',
  agent_task_comment: 'A comment on a task assigned to an agent',
  ai_agent_assigned: 'An AI agent was assigned a task',
  ai_agent_activity: 'Activity reported by an external AI agent webhook',

  // User and app state
  my_tasks_preferences_updated: 'My Tasks filter/sort preferences changed',
  user_settings_updated: 'User settings changed',
  feature_flags_updated: 'Feature flags changed; refetch them',
  external_sync_refresh: 'An external source (e.g. GitHub issues) changed; refetch the affected list',
} as const

export type SseEventType = keyof typeof SSE_EVENTS

export const SSE_EVENT_TYPES = Object.keys(SSE_EVENTS) as SseEventType[]

/** The shape `broadcastToUsers` accepts. */
export interface SseOutboundEvent {
  type: SseEventType
  timestamp?: string
  data?: unknown
}
