/**
 * Typing-indicator SSE broadcasts for the Astrid agent.
 *
 * processAstridMessage (channel-scoped) and processAstridComment
 * (task-scoped) each had inline broadcastToUsers calls with the same
 * shape. Centralising here so the start/stop pattern is consistent
 * across both code paths.
 *
 * Typing starts are best-effort (we don't await) so a slow SSE consumer
 * can't block the AI call. Typing stops *are* awaited on the happy path
 * so we don't leave a hanging indicator if the stop event is dropped.
 */

import { broadcastToUsers } from '@/lib/sse-utils'

export interface TypingScope {
  /** "channel" for chat-channel scope, "task" for task-comment scope. */
  scope: 'channel' | 'task'
  /** Channel ID or task ID, depending on scope. */
  scopeId: string
}

/**
 * Broadcast a typing-start event. Fire-and-forget — failures are logged
 * by the SSE layer but never propagate.
 */
export function startTyping(args: {
  recipients: string[]
  agentId: string
  agentName?: string
  scope: TypingScope
}): void {
  if (args.recipients.length === 0) return
  const data: Record<string, string | undefined> = {
    agentId: args.agentId,
    agentName: args.agentName,
    [args.scope.scope === 'channel' ? 'channelId' : 'taskId']: args.scope.scopeId,
  }
  broadcastToUsers(args.recipients, {
    type: 'agent_typing_start',
    timestamp: new Date().toISOString(),
    data,
  }).catch(() => {})
}

/**
 * Broadcast a typing-stop event. Fire-and-forget; the receiver clears
 * its own indicator on a timeout if the stop is dropped, so we don't
 * need to retry.
 */
export function stopTyping(args: {
  recipients: string[]
  agentId: string
  scope: TypingScope
}): void {
  if (args.recipients.length === 0) return
  const data: Record<string, string> = {
    agentId: args.agentId,
    [args.scope.scope === 'channel' ? 'channelId' : 'taskId']: args.scope.scopeId,
  }
  broadcastToUsers(args.recipients, {
    type: 'agent_typing_stop',
    timestamp: new Date().toISOString(),
    data,
  }).catch(() => {})
}
