/**
 * GitHub Copilot AI Provider
 *
 * Copilot's chat API is OpenAI-compatible, so this is a thin wrapper over
 * callOpenAI pointed at the Copilot endpoint with the integration headers
 * Copilot requires. The `apiKey` is a GitHub token belonging to a user with an
 * active Copilot subscription — entitlement follows the subscription, not the
 * OAuth app that minted the token, so a `gh auth token` works here.
 *
 * Verified live against api.githubcopilot.com: GET /models returns the model
 * list, and POST /chat/completions returns a completion with usage accounting.
 *
 * This deliberately does NOT use @github/copilot-sdk. That SDK spawns a
 * platform CLI binary, and the binary alone is ~253 MB — larger than Vercel's
 * 250 MB unzipped serverless function limit — so it cannot run where this
 * deploys. The REST API needs no runtime process.
 */

import { BRAND } from '@/lib/brand/config'
import type { AIProviderResponse } from './types'
import { callOpenAI, OPENAI_REPOSITORY_TOOLS, type OpenAIProviderOptions } from './openai-provider'

export const COPILOT_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export type CopilotProviderOptions = OpenAIProviderOptions

export const COPILOT_BASE_URL = 'https://api.githubcopilot.com'
export const COPILOT_HEADERS: Record<string, string> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': `${BRAND.appName}/1.0`,
}

export async function callCopilot(options: CopilotProviderOptions): Promise<AIProviderResponse> {
  return callOpenAI({
    ...options,
    model: options.model ?? 'gpt-4.1',
    baseUrl: COPILOT_BASE_URL,
    extraHeaders: { ...COPILOT_HEADERS, ...(options.extraHeaders ?? {}) },
  })
}
