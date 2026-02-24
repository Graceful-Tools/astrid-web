/**
 * Astrid Channel Plugin for OpenClaw
 *
 * Connect OpenClaw to Astrid.cc via outbound SSE — no inbound gateway URL needed.
 */

export { astridChannel as AstridChannel } from './channel.js'
export { SSEClient } from './sse-client.js'
export { OAuthClient } from './oauth-client.js'
export { RestClient } from './rest-client.js'
export { SessionMapper } from './session-mapper.js'
export { taskToMessage, commentToMessage, responseToComment } from './message-formatter.js'
export type {
  AstridChannelConfig,
  AgentTask,
  AgentComment,
  AgentSSEEvent,
  InboundMessage,
  OutboundMessage,
} from './types.js'
