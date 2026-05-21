/**
 * Regression: the AI API Key Manager rendered `SUGGESTED_MODELS[service]`
 * as <option key={model}>{model}</option>. claude-sonnet-4-6 was listed
 * twice, producing the React "two children with the same key" warning.
 * Pin that each service's suggestion list is duplicate-free.
 */
import { describe, it, expect } from 'vitest'
import { SUGGESTED_MODELS } from '@/lib/ai/agent-config'

describe('SUGGESTED_MODELS', () => {
  it('has no duplicate model ids per service', () => {
    for (const [service, models] of Object.entries(SUGGESTED_MODELS)) {
      if (!models) continue
      const seen = new Set(models)
      expect(seen.size, `duplicate model in ${service}: ${models.join(', ')}`).toBe(models.length)
    }
  })
})
