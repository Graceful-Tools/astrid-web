/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 14d: extracting the Profile section (display
 * name + email + avatar + Save) out of AccountSettings.tsx into
 * components/Settings/ProfileSection.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProfileSection } from '@/components/Settings/ProfileSection'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const accountData = {
  id: 'user-1',
  name: 'Jon',
  email: 'jon@example.com',
  image: null,
  verifiedViaOAuth: false,
  emailVerified: true,
} as any

describe('ProfileSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the current name and email from accountData', () => {
    render(<ProfileSection accountData={accountData} onSaved={vi.fn()} />)
    expect((screen.getByLabelText(/displayName/) as HTMLInputElement).value).toBe('Jon')
    expect((screen.getByLabelText(/emailAddress/) as HTMLInputElement).value).toBe('jon@example.com')
  })

  it('hides the Save Changes button until a field changes', () => {
    render(<ProfileSection accountData={accountData} onSaved={vi.fn()} />)
    expect(screen.queryByText('settingsPages.profileInfo.saveChanges')).not.toBeInTheDocument()
  })

  it('reveals the Save Changes button after a name edit', () => {
    render(<ProfileSection accountData={accountData} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/displayName/), { target: { value: 'Jon P' } })
    expect(screen.getByText('settingsPages.profileInfo.saveChanges')).toBeInTheDocument()
  })

  it('PUTs the updated profile and calls onSaved on Save', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
    ) as typeof fetch
    const onSaved = vi.fn(() => Promise.resolve())

    render(<ProfileSection accountData={accountData} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText(/displayName/), { target: { value: 'Jon P' } })
    fireEvent.click(screen.getByText('settingsPages.profileInfo.saveChanges'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/users/me',
      expect.objectContaining({ method: 'PUT' })
    )
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.name).toBe('Jon P')
    expect(body.email).toBe('jon@example.com')
  })

  it('re-syncs the draft when accountData changes externally', () => {
    const { rerender } = render(<ProfileSection accountData={accountData} onSaved={vi.fn()} />)
    rerender(<ProfileSection accountData={{ ...accountData, name: 'Jonathan' }} onSaved={vi.fn()} />)
    expect((screen.getByLabelText(/displayName/) as HTMLInputElement).value).toBe('Jonathan')
  })
})
