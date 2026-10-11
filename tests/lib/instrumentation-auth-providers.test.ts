/**
 * P2 (spec §6.2) — the server refuses to start when a listed opt-in provider
 * has no configuration, rather than rendering a button that fails.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@vercel/otel', () => ({ registerOTel: vi.fn() }))

const ORIGINAL_ENV = { ...process.env }

async function boot() {
  vi.resetModules()
  const { register } = await import('@/instrumentation')
  return register()
}

describe('instrumentation register() and the provider list', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('refuses to start with GitHub listed and no App OAuth client', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'github,passkey'
    delete process.env.GITHUB_CLIENT_ID
    delete process.env.GITHUB_CLIENT_SECRET

    await expect(boot()).rejects.toThrow(/github: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET/)
  })

  it('starts with GitHub listed and configured', async () => {
    process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = 'github,passkey'
    process.env.GITHUB_CLIENT_ID = 'Iv23test'
    process.env.GITHUB_CLIENT_SECRET = 'secret'

    await expect(boot()).resolves.toBeUndefined()
  })

  it('refuses to start with GitHub Projects on and Project Mode off (AWTD-1121)', async () => {
    process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = 'true'
    process.env.NEXT_PUBLIC_BRAND_ENABLE_PROJECT_MODE = 'false'

    await expect(boot()).rejects.toThrow(/GitHub Projects .* requires Project Mode/)
  })
})
