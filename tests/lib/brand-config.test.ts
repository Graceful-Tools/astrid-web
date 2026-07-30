/**
 * Whitelabel Phase 1 (task 97208a72) — brand configuration and i18n interpolation.
 *
 * The product used to hardcode "Astrid" and "astrid.cc" in ~480 files. Copy now stores
 * `{appName}` / `{brandDomain}` tokens and lib/brand/config.ts supplies the values, so a
 * fork rebrands via env alone. These tests pin the two properties that make that safe:
 *   1. with no env set, every value is still the Astrid default (no behaviour change);
 *   2. token substitution rewrites brand tokens and leaves real ICU arguments alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyBrandToMessages, applyBrandToString } from '@/lib/brand/i18n-values'
import enMessages from '@/lib/i18n/locales/en.json'

describe('BRAND defaults (task 97208a72)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_BRAND_') || key === 'BRAND_AGENT_EMAIL_DOMAIN') {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('falls back to the Astrid values when nothing is configured', async () => {
    const { BRAND, brandOrigin } = await import('@/lib/brand/config')

    expect(BRAND.appName).toBe('Astrid')
    expect(BRAND.productTitle).toBe('Astrid Task Manager')
    expect(BRAND.domain).toBe('astrid.cc')
    expect(BRAND.agentEmailDomain).toBe('astrid.cc')
    expect(BRAND.supportEmail).toBe('support@astrid.cc')
    expect(BRAND.inboundTaskEmail).toBe('remindme@astrid.cc')
    expect(BRAND.accentColor).toBe('#3b82f6')
    expect(BRAND.agentIdentityName).toBe('Astrid')
    expect(brandOrigin()).toBe('https://astrid.cc')
  })

  it('reads overrides from the environment', async () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Acme'
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = 'acme.example'

    const { BRAND, brandOrigin } = await import('@/lib/brand/config')

    expect(BRAND.appName).toBe('Acme')
    expect(BRAND.domain).toBe('acme.example')
    expect(brandOrigin()).toBe('https://acme.example')
  })

  it('derives the agent-email domain and agent name from the brand when unset', async () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Acme'
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = 'acme.example'

    const { BRAND } = await import('@/lib/brand/config')

    expect(BRAND.agentEmailDomain).toBe('acme.example')
    expect(BRAND.agentIdentityName).toBe('Acme')
  })

  it('lets the agent-email domain diverge from the web domain', async () => {
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = 'acme.example'
    process.env.BRAND_AGENT_EMAIL_DOMAIN = 'agents.acme.example'

    const { BRAND } = await import('@/lib/brand/config')

    expect(BRAND.domain).toBe('acme.example')
    expect(BRAND.agentEmailDomain).toBe('agents.acme.example')
  })

  it('treats a blank env var as unset rather than as an empty brand name', async () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = '   '

    const { BRAND } = await import('@/lib/brand/config')

    expect(BRAND.appName).toBe('Astrid')
  })
})

describe('brand token substitution in messages (task 97208a72)', () => {
  it('substitutes brand tokens', () => {
    expect(applyBrandToString('Connect {appName} to Copilot')).toBe('Connect Astrid to Copilot')
    expect(applyBrandToString('came from {brandDomain}.')).toBe('came from astrid.cc.')
    expect(applyBrandToString('Send TO {inboundTaskEmail}')).toBe('Send TO remindme@astrid.cc')
  })

  it('leaves real ICU arguments untouched', () => {
    // These are formatted by next-intl at render time and must survive verbatim.
    expect(applyBrandToString('{count} tasks in "{listName}"')).toBe('{count} tasks in "{listName}"')
    expect(applyBrandToString('{appName} has {count} tasks')).toBe('Astrid has {count} tasks')
  })

  it('walks nested objects and arrays without mutating the input', () => {
    const input = { a: { b: '{appName} here!' }, c: ['{appName}', 'plain'] }
    const output = applyBrandToMessages(input)

    expect(output).toEqual({ a: { b: 'Astrid here!' }, c: ['Astrid', 'plain'] })
    expect(input.a.b).toBe('{appName} here!')
  })

  it('leaves the en locale free of hardcoded brand literals', () => {
    // The whole point of Phase 1: no locale file may reintroduce a literal.
    expect(JSON.stringify(enMessages)).not.toMatch(/Astrid|astrid\.cc/)
  })

  it('renders the en locale with no unresolved brand tokens', () => {
    const rendered = JSON.stringify(applyBrandToMessages(enMessages))

    expect(rendered).not.toMatch(/\{appName\}|\{brandDomain\}|\{supportEmail\}|\{inboundTaskEmail\}/)
    expect(rendered).toMatch(/Astrid/)
  })
})
