/**
 * Provider-switch dispatch for the Astrid agent's AI service calls.
 *
 * processAstridMessage and processAstridComment each had an identical
 * switch(service) routing to callClaudeWithTools / callOpenAIWithTools /
 * callGeminiWithTools. Centralised here so adding a new provider is a
 * one-place change.
 *
 * The three call functions stay in lib/astrid-agent-runtime.ts since they
 * own the provider-specific request/response shapes; this is just the
 * routing layer.
 */

import type { AIService } from '@/lib/ai/agent-config'

export type ToolCallFn = (
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  toolContext: { userId: string },
  model?: string,
) => Promise<string>

export interface ProviderCallers {
  claude: ToolCallFn
  openai: ToolCallFn
  gemini: ToolCallFn
  copilot: ToolCallFn
}

/**
 * Route to the right tool-calling implementation based on the AI service.
 * Returns null for unknown services so the caller can no-op gracefully
 * (matches original switch-default behavior).
 */
export async function dispatchToolCall(args: {
  service: AIService
  apiKey: string
  systemPrompt: string
  userMessage: string
  toolContext: { userId: string }
  model?: string
  callers: ProviderCallers
}): Promise<string | null> {
  switch (args.service) {
    case 'claude':
      return args.callers.claude(args.apiKey, args.systemPrompt, args.userMessage, args.toolContext, args.model)
    case 'openai':
      return args.callers.openai(args.apiKey, args.systemPrompt, args.userMessage, args.toolContext, args.model)
    case 'gemini':
      return args.callers.gemini(args.apiKey, args.systemPrompt, args.userMessage, args.toolContext, args.model)
    case 'copilot':
      return args.callers.copilot(args.apiKey, args.systemPrompt, args.userMessage, args.toolContext, args.model)
    default:
      return null
  }
}
