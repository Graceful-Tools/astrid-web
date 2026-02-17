/**
 * @gracefultools/openclaw-astrid-channel
 *
 * OpenClaw channel plugin for Astrid.cc task management.
 * Thin wrapper around @gracefultools/astrid-sdk — all types,
 * formatting, and protocol logic live in the SDK.
 */

// Plugin wrapper (OpenClaw lifecycle)
export { AstridOpenClawChannel, type OpenClawChannelAPI } from './channel.js'

// Re-export SDK channel primitives for convenience
export {
  AstridChannel,
  ChannelOAuthClient,
  ChannelRestClient,
  SSEClient,
  SessionMapper,
  taskToMessage,
  commentToMessage,
  responseToComment,
} from '@gracefultools/astrid-sdk'

// Re-export SDK channel types
export type {
  AstridChannelConfig,
  ChannelAgentTask,
  ChannelAgentComment,
  AgentSSEEvent,
  InboundMessage,
  OutboundMessage,
} from '@gracefultools/astrid-sdk'
