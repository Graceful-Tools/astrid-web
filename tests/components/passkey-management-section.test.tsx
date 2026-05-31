/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 14: extracting the Passkey management block out
 * of components/Settings/AccountSettings.tsx into
 * components/Settings/PasskeyManagementSection.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasskeyManagementSection } from '@/components/Settings/PasskeyManagementSection'
import { useWebAuthn } from '@/hooks/use-webauthn'

vi.mock('@/hooks/use-webauthn', () => ({ useWebAuthn: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

const mockUseWebAuthn = vi.mocked(useWebAuthn)

function webAuthn(overrides: Partial<ReturnType<typeof useWebAuthn>> = {}) {
  return {
    isSupported: true,
    isLoading: false,
    error: null,
    registerPasskey: vi.fn(() => Promise.resolve({ success: true })),
    clearError: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useWebAuthn>
}

function mockPasskeysFetch(passkeys: unknown[] = []) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ passkeys }) } as Response)
  ) as typeof fetch
}

const samplePasskey = {
  id: 'pk-1',
  name: 'My Phone',
  credentialDeviceType: 'multiDevice',
  credentialBackedUp: true,
  createdAt: '2026-05-01T00:00:00.000Z',
}

describe('PasskeyManagementSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWebAuthn.mockReturnValue(webAuthn())
    mockPasskeysFetch([])
  })

  it('renders nothing when passkeys are not supported', () => {
    mockUseWebAuthn.mockReturnValue(webAuthn({ isSupported: false }))
    const { container } = render(<PasskeyManagementSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the loaded passkeys', async () => {
    mockPasskeysFetch([samplePasskey])
    render(<PasskeyManagementSection />)
    expect(await screen.findByText('My Phone')).toBeInTheDocument()
  })

  it('shows the empty state when there are no passkeys', async () => {
    mockPasskeysFetch([])
    render(<PasskeyManagementSection />)
    expect(
      await screen.findByText('settingsPages.passkeys.noPasskeys')
    ).toBeInTheDocument()
  })

  it('registers a new passkey when Add Passkey is clicked', async () => {
    const registerPasskey = vi.fn(() => Promise.resolve({ success: true }))
    mockUseWebAuthn.mockReturnValue(webAuthn({ registerPasskey: registerPasskey as never }))
    mockPasskeysFetch([])

    render(<PasskeyManagementSection />)
    fireEvent.click(await screen.findByText('settingsPages.passkeys.addPasskey'))

    await waitFor(() => expect(registerPasskey).toHaveBeenCalled())
  })

  it('deletes a passkey via the webauthn endpoint', async () => {
    mockPasskeysFetch([samplePasskey])
    render(<PasskeyManagementSection />)
    await screen.findByText('My Phone')

    const deleteButtons = screen.getAllByRole('button')
    // The trash button is the last action button on the passkey row.
    fireEvent.click(deleteButtons[deleteButtons.length - 2])

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/webauthn/passkeys?id=pk-1',
        expect.objectContaining({ method: 'DELETE' })
      )
    )
  })
})
