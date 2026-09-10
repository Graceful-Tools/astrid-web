/**
 * @vitest-environment jsdom
 */

/**
 * Account settings: resend verification / cancel email change (AWTD-886)
 *
 * Both buttons were dead. The handlers posted `{ action: "resend" }` as a JSON
 * BODY, and `/api/v1/users/me/verify-email` reads the action from the QUERY
 * STRING — so `searchParams.get('action')` was null, the switch fell to its
 * default, and the endpoint answered 400 with *"Invalid action. Use 'resend',
 * 'cancel', or 'send'"*. The client renders `error.error` straight into a
 * toast, so a user clicking Resend was shown a developer's error message.
 *
 * The endpoint has always been query-shaped — the token flow (`?token=`) forces
 * that — and the sibling caller in `app/[locale]/auth/verify-email` got it
 * right. This one call site spelled the URL differently, so what is pinned here
 * is the URL each button actually requests.
 *
 * A shared URL builder was the obvious next step and is deliberately NOT the
 * fix. Replacing the literal with `emailVerificationActionUrl('resend')` made
 * `tests/rules/raw-fetch-mutations-ratchet.test.ts` count three FEWER raw
 * mutations — its detector matches a string literal containing `/api/`, so the
 * calls had not stopped bypassing the offline client, they had stopped being
 * visible. A ratchet that silently stops covering a call site is worse than no
 * ratchet, because the green test reads as proof.
 *
 * The two calls go through `apiPost` instead, which is what the API boundary
 * guard asks for and what makes the count fall honestly. The body is `{}` on
 * purpose: the endpoint reads nothing from it.
 *
 * The section itself is stubbed. What is under test is the request the handler
 * makes, not the markup of the card that triggers it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { id: 'u1' } } }),
  signOut: vi.fn(),
}))

// One instance, not one per render: AccountSettings' effect depends on the
// searchParams object, so a fresh one each call re-runs it forever.
const SEARCH_PARAMS = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => SEARCH_PARAMS,
}))

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (key: string) => key }) }))

// Stubbed so the test targets the handler's request rather than the card's
// markup — the cancel control is an icon-only button with no accessible name.
vi.mock('@/components/Settings/EmailVerificationSection', () => ({
  EmailVerificationSection: ({
    onResendVerification,
    onCancelEmailChange,
  }: {
    onResendVerification: () => void
    onCancelEmailChange: () => void
  }) => (
    <div>
      <button onClick={onResendVerification}>resend</button>
      <button onClick={onCancelEmailChange}>cancel</button>
    </div>
  ),
}))

vi.mock('@/components/Settings/PasskeyManagementSection', () => ({ PasskeyManagementSection: () => null }))
vi.mock('@/components/Settings/AccountInfoSection', () => ({ AccountInfoSection: () => null }))
vi.mock('@/components/Settings/DataExportSection', () => ({ DataExportSection: () => null }))
vi.mock('@/components/Settings/AccountDeletionSection', () => ({ AccountDeletionSection: () => null }))
vi.mock('@/components/Settings/ProfileSection', () => ({ ProfileSection: () => null }))

import AccountSettings from '@/components/Settings/AccountSettings'

const ACCOUNT = {
  id: 'u1',
  name: 'Owner',
  email: 'owner@example.com',
  emailVerified: null,
  image: null,
  pendingEmail: 'new@example.com',
  verified: false,
  hasPendingChange: true,
  hasPendingVerification: true,
}

/** The URL of the Nth fetch the component made, as a string. */
function fetchedUrls(): string[] {
  return vi.mocked(global.fetch).mock.calls.map(call => String(call[0]))
}

function fetchInit(url: string): RequestInit | undefined {
  const call = vi.mocked(global.fetch).mock.calls.find(c => String(c[0]).includes(url))
  return call?.[1] as RequestInit | undefined
}

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ user: ACCOUNT, success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as never
})

describe('AccountSettings verification actions (AWTD-886)', () => {
  it('sends resend as a query parameter, which is where the route reads it', async () => {
    render(<AccountSettings />)
    await waitFor(() => expect(fetchedUrls()).toContain('/api/v1/users/me'))

    await userEvent.click(screen.getByRole('button', { name: 'resend' }))

    await waitFor(() =>
      expect(fetchedUrls()).toContain('/api/v1/users/me/verify-email?action=resend'),
    )
  })

  it('sends cancel as a query parameter too', async () => {
    render(<AccountSettings />)
    await waitFor(() => expect(fetchedUrls()).toContain('/api/v1/users/me'))

    await userEvent.click(screen.getByRole('button', { name: 'cancel' }))

    await waitFor(() =>
      expect(fetchedUrls()).toContain('/api/v1/users/me/verify-email?action=cancel'),
    )
  })

  it('does not put the action in the body, where nothing reads it', async () => {
    // The original bug exactly: a body-only action is invisible to the route,
    // which answers 400 and hands the user a developer's error string.
    render(<AccountSettings />)
    await waitFor(() => expect(fetchedUrls()).toContain('/api/v1/users/me'))

    await userEvent.click(screen.getByRole('button', { name: 'resend' }))

    await waitFor(() => {
      const init = fetchInit('verify-email')
      expect(init?.method).toBe('POST')
      expect(String(init?.body ?? '')).not.toContain('action')
    })
  })
})
