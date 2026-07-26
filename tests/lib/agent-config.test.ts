/**
 * Regression: the AI API Key Manager rendered `SUGGESTED_MODELS[service]`
 * as <option key={model}>{model}</option>. claude-sonnet-4-6 was listed
 * twice, producing the React "two children with the same key" warning.
 * Pin that each service's suggestion list is duplicate-free.
 */
import { describe, it, expect } from 'vitest'
import {
  SUGGESTED_MODELS,
  DEFAULT_MODELS,
  AI_AGENT_CONFIG,
  getAgentConfig,
  getAgentService,
  isRegisteredAgent,
} from '@/lib/ai/agent-config'

describe('SUGGESTED_MODELS', () => {
  it('has no duplicate model ids per service', () => {
    for (const [service, models] of Object.entries(SUGGESTED_MODELS)) {
      if (!models) continue
      const seen = new Set(models)
      expect(seen.size, `duplicate model in ${service}: ${models.join(', ')}`).toBe(models.length)
    }
  })
})

/**
 * Task eed98c5f: Add GitHub Copilot as a first-class agent option, in the
 * same way Claude / OpenAI / Gemini are supported. Copilot must resolve
 * through the same agent-config registry the orchestrator routes on.
 */
describe('GitHub Copilot agent registration (task eed98c5f)', () => {
  const COPILOT_EMAIL = 'copilot@astrid.cc'

  it('registers copilot@astrid.cc in AI_AGENT_CONFIG', () => {
    expect(AI_AGENT_CONFIG[COPILOT_EMAIL]).toBeDefined()
    expect(isRegisteredAgent(COPILOT_EMAIL)).toBe(true)
  })

  it('routes copilot@astrid.cc to the copilot service', () => {
    expect(getAgentService(COPILOT_EMAIL)).toBe('copilot')
    expect(getAgentConfig(COPILOT_EMAIL)?.service).toBe('copilot')
  })

  it('uses the copilot_agent agentType and ASTRID.md context file', () => {
    const config = getAgentConfig(COPILOT_EMAIL)
    expect(config?.agentType).toBe('copilot_agent')
    expect(config?.contextFile).toBe('ASTRID.md')
  })

  it('provides suggested and default models for copilot', () => {
    expect(SUGGESTED_MODELS.copilot?.length).toBeGreaterThan(0)
    expect(DEFAULT_MODELS.copilot).toBeTruthy()
    // Default must be one of the suggestions so the picker can preselect it.
    expect(SUGGESTED_MODELS.copilot).toContain(DEFAULT_MODELS.copilot)
  })
})
