/**
 * AWTD-1604: the Toaster now loads after hydration (components/providers.tsx). A toast
 * raised before its chunk arrives must still show: hooks/use-toast.ts keeps toasts in a
 * module store, which useToast() starts from, and an auto-dismiss clock does not start
 * until a Toaster is mounted to show the toast.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/settings-context', () => ({ useSettings: () => ({ toastDebugMode: true }) }))

import { toast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'

afterEach(() => { vi.useRealTimers() })

describe('AWTD-1604: a toast raised before the Toaster mounts is not lost', () => {
  it('shows a toast dispatched before the Toaster rendered', async () => {
    act(() => { toast({ title: 'Saved before the toaster loaded' }) })
    render(<Toaster />)
    expect(await screen.findByText('Saved before the toaster loaded')).toBeTruthy()
  })

  it('does not run down a short duration while the Toaster is still loading', () => {
    vi.useFakeTimers()
    act(() => { toast({ title: 'Short and early', duration: 50 }) })
    // The Toaster chunk takes longer than the toast's duration to arrive.
    act(() => { vi.advanceTimersByTime(500) })
    const { unmount } = render(<Toaster />)
    expect(screen.getByText('Short and early')).toBeTruthy()
    unmount()
  })
})
