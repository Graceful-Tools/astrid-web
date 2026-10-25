/**
 * P2 (spec §6.2) — the sign-in page offers the opt-in providers the brand
 * lists, and none it does not.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
  getProviders: vi.fn(async () => ({ sso: { id: 'sso', name: 'Acme SSO' } })),
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
}))
vi.mock('@/hooks/use-webauthn', () => ({
  useWebAuthn: () => ({
    isSupported: true, isLoading: false, error: null,
    registerPasskey: vi.fn(), authenticateWithPasskey: vi.fn(), clearError: vi.fn(),
  }),
}))

const ORIGINAL_ENV = { ...process.env }

async function renderWith(providers: string | undefined) {
  vi.resetModules()
  if (providers === undefined) delete process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS
  else process.env.NEXT_PUBLIC_BRAND_AUTH_PROVIDERS = providers
  const { SignInContent } = await import('@/app/[locale]/auth/signin/signin-client')
  render(<SignInContent />)
}

describe('sign-in provider buttons', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('shows no GitHub or SSO button by default', async () => {
    await renderWith(undefined)
    expect(screen.queryByText('Continue with GitHub')).toBeNull()
    expect(screen.queryByText(/Continue with SSO/)).toBeNull()
  })

  it('shows GitHub and the IdP-labelled SSO button when listed', async () => {
    await renderWith('github,sso,passkey')
    expect(screen.getByText('Continue with GitHub')).toBeTruthy()
    expect(await screen.findByText('Continue with Acme SSO')).toBeTruthy()
    expect(screen.queryByText('Continue with Google')).toBeNull()
  })
})
