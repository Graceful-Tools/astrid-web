/**
 * Re-export all channel types from the SDK.
 * This plugin adds no new types — it's a thin OpenClaw wrapper.
 */
export type {
  AstridChannelConfig,
  ChannelAgentTask as AgentTask,
  ChannelAgentComment as AgentComment,
  AgentSSEEvent,
  InboundMessage,
  OutboundMessage,
} from '@gracefultools/astrid-sdk'
