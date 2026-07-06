/**
 * GitHub Copilot AI Provider
 *
 * Copilot's chat API is OpenAI-compatible, so this is a thin wrapper over
 * callOpenAI pointed at the Copilot endpoint with the integration headers
 * Copilot requires. The `apiKey` is a Copilot token (a GitHub token with an
 * active Copilot subscription, or a Copilot API key).
 *
 * NOTE: the base URL + headers below follow GitHub's documented Copilot chat
 * API; verify against the live API for your integration id before relying on
 * it in production.
 */

import type { AIProviderResponse } from './types'
import { callOpenAI, OPENAI_REPOSITORY_TOOLS, type OpenAIProviderOptions } from './openai-provider'

export const COPILOT_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export type CopilotProviderOptions = OpenAIProviderOptions

const COPILOT_BASE_URL = 'https://api.githubcopilot.com'
const COPILOT_HEADERS: Record<string, string> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': 'Astrid/1.0',
}

export async function callCopilot(options: CopilotProviderOptions): Promise<AIProviderResponse> {
  return callOpenAI({
    ...options,
    model: options.model ?? 'gpt-4o',
    baseUrl: COPILOT_BASE_URL,
    extraHeaders: { ...COPILOT_HEADERS, ...(options.extraHeaders ?? {}) },
  })
}
