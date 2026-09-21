/**
 * Muse provider — Meta's Llama API via its OpenAI-compatible endpoint.
 *
 * The Llama API exposes an OpenAI-compatible surface at
 * https://api.llama.com/compat/v1 (chat completions, models listing), so this
 * provider reuses the OpenAI call path with the Muse base URL and default
 * model. Auth is a Bearer <redacted> API key created in the API Dashboard at
 * https://llama.developer.meta.com (keys are formatted `LLM|…`).
 *
 * Mirrors lib/ai/providers/copilot-provider.ts: the same wrapped-callOpenAI
 * shape, so the tool-call contract the orchestrator relies on is unchanged.
 * The Llama API needs no extra headers — unlike Copilot, plain Bearer auth
 * is enough.
 */

import type { AIProviderResponse } from './types'
import { callOpenAI, OPENAI_REPOSITORY_TOOLS, type OpenAIProviderOptions } from './openai-provider'
import { DEFAULT_MODELS } from '../agent-config'

export const MUSE_BASE_URL = 'https://api.llama.com/compat/v1'

export const MUSE_DEFAULT_MODEL = DEFAULT_MODELS.muse ?? 'Llama-4-Maverick-17B-128E-Instruct-FP8'

export const MUSE_REPOSITORY_TOOLS = OPENAI_REPOSITORY_TOOLS

export type MuseProviderOptions = OpenAIProviderOptions

export async function callMuse(options: MuseProviderOptions): Promise<AIProviderResponse> {
  return callOpenAI({
    ...options,
    model: options.model ?? MUSE_DEFAULT_MODEL,
    baseUrl: MUSE_BASE_URL,
  })
}
