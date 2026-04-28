import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai.user-config-schemas')


/**
 * Zod schemas for the three JSON-as-string AI config blobs on the User row.
 *
 * All schemas use `.passthrough()` so legacy or partially-migrated rows with
 * extra fields keep round-tripping unchanged. Validation only rejects values
 * whose KNOWN fields have the wrong type — unknown fields are preserved.
 *
 * `parseUserAIConfig` returns `{}` (typed as the schema's output) on parse
 * failure and logs a warning, never throws. Callers historically assumed
 * `JSON.parse(... ?? {})` succeeds; preserving that contract avoids regressions.
 */

export const AIAssistantSettingsSchema = z
  .object({
    preferredService: z.string().nullable().optional(),
    defaultAgentId: z.string().nullable().optional(),
  })
  .passthrough()

export type AIAssistantSettings = z.infer<typeof AIAssistantSettingsSchema>

// Per-key entry shape varies: some callsites use `encrypted: boolean` as a
// flag, others store `{ encrypted: <ciphertext>, iv: <iv>, isGateway, isValid,
// lastTested, ... }`. Treating the inner record as `unknown` reflects this and
// keeps the schema useful at the read boundary without locking down the
// concrete shape — that lives in the encryption util.
export const MCPSettingsSchema = z
  .object({
    apiKeys: z.record(z.record(z.unknown())).optional(),
    modelPreferences: z.record(z.string()).optional(),
  })
  .passthrough()

export type MCPSettings = z.infer<typeof MCPSettingsSchema>

export const AIAgentConfigSchema = z
  .object({
    registeredBy: z.string().optional(),
    agentName: z.string().optional(),
    version: z.string().optional(),
    registeredAt: z.string().optional(),
  })
  .passthrough()

export type AIAgentConfig = z.infer<typeof AIAgentConfigSchema>

export function parseUserAIConfig<T extends z.ZodTypeAny>(
  raw: string | null | undefined,
  schema: T,
  context: string
): z.infer<T> {
  if (!raw) {
    return schema.parse({})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    log.warn({ err }, `[user-config-schemas] ${context}: invalid JSON, returning empty`)
    return schema.parse({})
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    log.warn(result.error.issues, `[user-config-schemas] ${context}: schema mismatch, returning empty`)
    return schema.parse({})
  }
  return result.data
}
