/**
 * Chat Agent Dispatch
 *
 * Handles dispatching chat_mention events to AI agents when they are
 * mentioned in chat messages. Parallels lib/ai-agent-comment-service.ts.
 */

import { broadcastToUsers } from '@/lib/sse-utils'

interface DispatchChatMentionParams {
  channelId: string
  listId: string | null
  messageId: string
  content: string
  authorId: string
  authorName: string
  mentionedAgentId: string
  /** True when the agent was resolved as a default agent, not explicitly @mentioned */
  isDefaultAgent?: boolean
}

/**
 * Dispatch a chat_mention SSE event to an AI agent.
 * The agent worker picks this up and processes the mention.
 */
export async function dispatchChatMention(params: DispatchChatMentionParams) {
  try {
    await broadcastToUsers([params.mentionedAgentId], {
      type: 'chat_mention',
      timestamp: new Date().toISOString(),
      data: {
        channelId: params.channelId,
        listId: params.listId,
        messageId: params.messageId,
        content: params.content,
        authorId: params.authorId,
        authorName: params.authorName,
        mentionedAgentId: params.mentionedAgentId,
        isDefaultAgent: params.isDefaultAgent || false,
      },
    })
  } catch (error) {
    console.error('[ChatAgentDispatch] Failed to dispatch mention:', error)
  }
}
