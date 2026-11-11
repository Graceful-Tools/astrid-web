/**
 * AWTD-1575: the offline / back-online toast lost its colour cue.
 *
 * It was an orange or green slab with white text. The palette conversion made
 * it a readable surface card with a coloured border and neutral text, so the
 * only cue left was a 1px line. The icon carries the status colour again.
 */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PWAStatus } from '@/components/pwa-status'

vi.mock('@/lib/offline-sync', () => ({
  OfflineSyncManager: {
    getMutationStats: vi.fn().mockResolvedValue({ pending: 0 }),
    syncPendingMutations: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('AWTD-1575: the offline toast says which state it is by colour', () => {
  it('offline: the icon is the warning ink; back online: the success ink; the text stays neutral', async () => {
    render(<PWAStatus />)

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    const offline = screen.getByText('You are offline')
    const offlineCard = offline.closest('.bg-theme-surface')!
    expect(offlineCard.className).toContain('text-theme-primary')
    expect(offlineCard.querySelector('svg')!.getAttribute('class')).toContain('text-warning')

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    const online = screen.getByText('Back online')
    expect(online.closest('.bg-theme-surface')!.querySelector('svg')!.getAttribute('class')).toContain('text-success')
  })
})
