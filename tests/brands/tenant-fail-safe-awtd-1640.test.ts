// @vitest-environment node
/**
 * AWTD-1640 — a partner that leaves a value unset must not inherit Astrid's.
 *
 * AWTD-1584 moved the legal operator and the feature-request address onto the brand, but
 * both still fell back to something a partner never chose: the operator became the
 * partner's brand name (a legal statement nobody made), and a partner without its own
 * support address mailed feature requests to support@astrid.cc. A partner here is any
 * deployment whose app name or domain is not Astrid's. Hosted Astrid, with nothing
 * configured, must render and send exactly what it did before.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

const KEYS = [
  'NEXT_PUBLIC_BRAND_NAME',
  'NEXT_PUBLIC_BRAND_DOMAIN',
  'NEXT_PUBLIC_BRAND_OPERATOR_NAME',
  'NEXT_PUBLIC_BRAND_SUPPORT_EMAIL',
  'NEXT_PUBLIC_BRAND_TERMS_URL',
  'NEXT_PUBLIC_BRAND_PRIVACY_URL',
  'FEATURE_REQUEST_EMAIL',
]
const ORIGINAL = { ...process.env }

function setEnv(env: Record<string, string>) {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, env)
  vi.resetModules()
}

async function renderTerms(): Promise<string> {
  const React = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { TermsOfServiceContent } = await import('@/components/legal/TermsOfServiceContent')
  const { LegalFooter } = await import('@/components/legal/LegalFooter')
  return renderToStaticMarkup(
    React.createElement(React.Fragment, null,
      React.createElement(TermsOfServiceContent),
      React.createElement(LegalFooter as React.ComponentType<{ surface: 'page' | 'settings'; children?: React.ReactNode }>, { surface: 'page' }, React.createElement('a', { href: '/privacy' }, 'Privacy')),
    ),
  )
}

afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.resetModules()
})

describe('legal operator fails safe for a partner (AWTD-1640)', () => {
  it('hosted Astrid still names Graceful Tools LLC, byte for byte', async () => {
    setEnv({})
    const html = await renderTerms()
    expect(html).toContain('>Astrid is a task management application operated by Graceful Tools LLC. By using Astrid, you agree to these terms.</p>')
    expect(html).toContain('>To the extent permitted by law, Graceful Tools LLC isn&#x27;t liable for indirect damages, data loss, or service interruptions.</p>')
    expect(html).toContain(`© ${new Date().getFullYear()} Graceful Tools LLC`)
  })

  it('a partner with no operator set names no operator at all', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme' })
    const { BRAND } = await import('@/lib/brand/config')
    expect(BRAND.operatorName).toBe('')
    const html = await renderTerms()
    expect(html).not.toContain('operated by')
    expect(html).not.toContain('Graceful Tools')
    expect(html).not.toContain('©')
    expect(html).toContain('>Acme is a task management application. By using Acme, you agree to these terms.</p>')
    expect(html).toContain('>To the extent permitted by law, we aren&#x27;t liable for indirect damages, data loss, or service interruptions.</p>')
  })

  it('a self-host that only changed its domain is a partner too', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_DOMAIN: 'tasks.example.org' })
    const { BRAND } = await import('@/lib/brand/config')
    expect(BRAND.operatorName).toBe('')
  })

  it('a partner that names its operator gets it everywhere', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme', NEXT_PUBLIC_BRAND_OPERATOR_NAME: 'Acme Corp, Inc.' })
    const html = await renderTerms()
    expect(html).toContain('Acme is a task management application operated by Acme Corp, Inc.')
    expect(html).toContain(`© ${new Date().getFullYear()} Acme Corp, Inc.`)
  })
})

describe('feature requests never default to Astrid for a partner (AWTD-1640)', () => {
  it('hosted Astrid still sends to its support address', async () => {
    setEnv({})
    const { featureRequestRecipient } = await import('@/lib/feature-access-requests')
    const { ASTRID_SUPPORT_EMAIL } = await import('@/lib/brand/config')
    expect(featureRequestRecipient()).toBe(ASTRID_SUPPORT_EMAIL)
  })

  it('a partner with neither address set has no recipient', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme', NEXT_PUBLIC_BRAND_DOMAIN: 'tasks.acme.example' })
    const { featureRequestRecipient } = await import('@/lib/feature-access-requests')
    expect(featureRequestRecipient()).toBeNull()
  })

  it('a partner with its own support address sends there', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme', NEXT_PUBLIC_BRAND_SUPPORT_EMAIL: 'help@acme.example' })
    const { featureRequestRecipient } = await import('@/lib/feature-access-requests')
    expect(featureRequestRecipient()).toBe('help@acme.example')
  })

  it('FEATURE_REQUEST_EMAIL wins for anyone', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme', FEATURE_REQUEST_EMAIL: 'team@acme.example' })
    const { featureRequestRecipient } = await import('@/lib/feature-access-requests')
    expect(featureRequestRecipient()).toBe('team@acme.example')
  })

  it('sends no email when a partner has no recipient', async () => {
    setEnv({ NEXT_PUBLIC_BRAND_NAME: 'Acme' })
    const sendTransportEmail = vi.fn(async () => ({ id: 'x' }))
    vi.doMock('@/lib/email-transport', () => ({ isEmailTransportLive: () => true, sendTransportEmail }))
    const { sendFeatureAccessRequestEmail } = await import('@/lib/email')
    await sendFeatureAccessRequestEmail({ featureKey: 'k', useCase: null, userEmail: 'u@acme.example', userName: null })
    expect(sendTransportEmail).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/email-transport')
  })
})
