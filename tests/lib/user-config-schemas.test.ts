import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AIAssistantSettingsSchema,
  MCPSettingsSchema,
  AIAgentConfigSchema,
  parseUserAIConfig,
} from '@/lib/ai/user-config-schemas'

describe('parseUserAIConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('returns empty schema when raw is null/undefined/empty', () => {
    expect(parseUserAIConfig(null, AIAssistantSettingsSchema, 'test')).toEqual({})
    expect(parseUserAIConfig(undefined, AIAssistantSettingsSchema, 'test')).toEqual({})
    expect(parseUserAIConfig('', AIAssistantSettingsSchema, 'test')).toEqual({})
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('parses valid JSON matching schema', () => {
    const json = JSON.stringify({ preferredService: 'openai', defaultAgentId: 'agent-1' })
    const result = parseUserAIConfig(json, AIAssistantSettingsSchema, 'test')
    expect(result.preferredService).toBe('openai')
    expect(result.defaultAgentId).toBe('agent-1')
  })

  it('returns empty object and warns on invalid JSON', () => {
    const result = parseUserAIConfig('{not valid', AIAssistantSettingsSchema, 'test')
    expect(result).toEqual({})
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('invalid JSON'),
      expect.anything()
    )
  })

  it('returns empty object and warns when known fields have wrong type', () => {
    const json = JSON.stringify({ preferredService: 42 }) // should be string
    const result = parseUserAIConfig(json, AIAssistantSettingsSchema, 'test')
    expect(result).toEqual({})
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema mismatch'),
      expect.anything()
    )
  })

  it('preserves unknown fields via passthrough (back-compat)', () => {
    const json = JSON.stringify({
      preferredService: 'anthropic',
      legacyFieldFromOldClient: { foo: 'bar' },
      anotherLegacy: 123,
    })
    const result = parseUserAIConfig(json, AIAssistantSettingsSchema, 'test') as Record<
      string,
      unknown
    >
    expect(result.preferredService).toBe('anthropic')
    expect(result.legacyFieldFromOldClient).toEqual({ foo: 'bar' })
    expect(result.anotherLegacy).toBe(123)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('MCPSettingsSchema', () => {
  it('parses apiKeys with encrypted flag', () => {
    const json = JSON.stringify({
      apiKeys: {
        openai: { encrypted: true, ciphertext: 'abc' },
        anthropic: { encrypted: false },
      },
      modelPreferences: { 'gpt-4o': 'fast', 'claude-opus-4-7': 'careful' },
    })
    const result = parseUserAIConfig(json, MCPSettingsSchema, 'test')
    expect(result.apiKeys?.openai?.encrypted).toBe(true)
    expect(result.modelPreferences?.['gpt-4o']).toBe('fast')
    // Passthrough preserves the extra ciphertext field
    expect((result.apiKeys?.openai as Record<string, unknown>)?.ciphertext).toBe('abc')
  })

  it('rejects non-object apiKeys entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = JSON.stringify({ apiKeys: { openai: 'not-an-object' } })
    const result = parseUserAIConfig(json, MCPSettingsSchema, 'test')
    expect(result).toEqual({})
    warnSpy.mockRestore()
  })
})

describe('AIAgentConfigSchema', () => {
  it('parses openclaw register payload shape', () => {
    const json = JSON.stringify({
      registeredBy: 'user-1',
      agentName: 'my-agent',
      version: '1.0',
      registeredAt: '2026-04-27T00:00:00Z',
    })
    const result = parseUserAIConfig(json, AIAgentConfigSchema, 'test')
    expect(result.registeredBy).toBe('user-1')
    expect(result.agentName).toBe('my-agent')
    expect(result.version).toBe('1.0')
  })
})
