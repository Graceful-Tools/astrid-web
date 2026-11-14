/**
 * AWTD-1592 — a signed-in page reports its language, once per change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({
  locale: 'de',
  session: { status: 'authenticated', data: { user: { id: 'u1' } } } as { status: string; data: unknown },
  apiPut: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next-intl', () => ({ useLocale: () => state.locale }))
vi.mock('next-auth/react', () => ({ useSession: () => state.session }))
vi.mock('@/lib/api', () => ({ apiPut: state.apiPut }))

import { LocaleSync, LOCALE_REPORTED_KEY } from '@/components/locale-sync'

describe('LocaleSync (AWTD-1592)', () => {
  beforeEach(() => {
    state.apiPut.mockClear()
    state.locale = 'de'
    state.session = { status: 'authenticated', data: { user: { id: 'u1' } } }
    window.localStorage.removeItem(LOCALE_REPORTED_KEY)
  })

  it('reports the page locale for a signed-in user', async () => {
    render(<LocaleSync />)
    await waitFor(() => expect(state.apiPut).toHaveBeenCalledWith('/api/v1/users/me/settings', { locale: 'de' }))
  })

  it('does not report the same language twice', async () => {
    const { unmount } = render(<LocaleSync />)
    await waitFor(() => expect(state.apiPut).toHaveBeenCalledTimes(1))
    unmount()
    render(<LocaleSync />)
    await new Promise((r) => setTimeout(r, 0))
    expect(state.apiPut).toHaveBeenCalledTimes(1)
  })

  it('reports again when the language changes', async () => {
    const { rerender } = render(<LocaleSync />)
    await waitFor(() => expect(state.apiPut).toHaveBeenCalledTimes(1))
    state.locale = 'fr'
    rerender(<LocaleSync />)
    await waitFor(() => expect(state.apiPut).toHaveBeenLastCalledWith('/api/v1/users/me/settings', { locale: 'fr' }))
  })

  it('says nothing for a signed-out visitor', async () => {
    state.session = { status: 'unauthenticated', data: null }
    render(<LocaleSync />)
    await new Promise((r) => setTimeout(r, 0))
    expect(state.apiPut).not.toHaveBeenCalled()
  })
})
