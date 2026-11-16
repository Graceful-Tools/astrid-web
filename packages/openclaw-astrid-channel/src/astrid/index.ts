/**
 * The Astrid SSE channel: task and comment events in over outbound SSE, replies
 * out over REST, with restart recovery. No inbound gateway URL needed.
 *
 * Moved here from @gracefultools/astrid-sdk in AWTD-1691. This package was its
 * only user, and the SDK is now an agent runner and typed client, not a
 * library for building agents.
 */

export { astridChannel as AstridChannel } from './channel.js'
export { SSEClient } from './sse-client.js'
export { OAuthClient, OAuthClient as ChannelOAuthClient } from './oauth-client.js'
export { RestClient, RestClient as ChannelRestClient } from './rest-client.js'
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
