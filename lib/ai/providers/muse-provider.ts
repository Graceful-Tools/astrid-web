/**
 * Muse (Meta) AI Provider — AWTD-1053
 *
 * Meta's Model API (launched 2026-07-09) serves the Muse Spark models through an
 * OpenAI-compatible REST surface, so this is a thin wrapper over callOpenAI
 * pointed at Meta's base URL, the same shape as the Copilot provider. The
 * `apiKey` is a Meta Developer Console key, sent as a Bearer token.
 *
 * Not to be confused with Muse Code, Meta's terminal agent: that is a CLI on the
 * user's machine that polls the `muse@` queue (lib/ai/harness-agents.ts). This
 * provider is what runs `muse@` — and the assistant — when the user puts it in
 * API mode instead.
 */

import type { AIProviderResponse } from './types'
import { callOpenAI, OPENAI_REPOSITORY_TOOLS, type OpenAIProviderOptions } from './openai-provider'

export const MUSE_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export type MuseProviderOptions = OpenAIProviderOptions

export const MUSE_BASE_URL = 'https://api.meta.ai/v1'
export const MUSE_DEFAULT_MODEL = 'muse-spark-1.3'

export async function callMuse(options: MuseProviderOptions): Promise<AIProviderResponse> {
  return callOpenAI({
    ...options,
    model: options.model ?? MUSE_DEFAULT_MODEL,
    baseUrl: MUSE_BASE_URL,
  })
}
