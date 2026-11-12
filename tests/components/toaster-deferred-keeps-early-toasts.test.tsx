/**
 * AWTD-1604: the Toaster now loads after hydration (components/providers.tsx). A toast
 * raised before its chunk arrives must still show: hooks/use-toast.ts keeps toasts in a
 * module store, and useToast() starts from it.
 */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/settings-context', () => ({ useSettings: () => ({ toastDebugMode: true }) }))

import { toast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'

describe('AWTD-1604: a toast raised before the Toaster mounts is not lost', () => {
  it('shows a toast dispatched before the Toaster rendered', async () => {
    act(() => { toast({ title: 'Saved before the toaster loaded' }) })
    render(<Toaster />)
    expect(await screen.findByText('Saved before the toaster loaded')).toBeTruthy()
  })
})
