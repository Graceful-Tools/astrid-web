import { describe, expect, it } from 'vitest'
import { shouldHandleMobileListSwipe } from '@/hooks/use-mobile-list-swipe-gate'

const base = {
  isMobile: true,
  mobileView: 'list',
  showMobileSidebar: false,
  isBoardMode: false,
}

describe('shouldHandleMobileListSwipe', () => {
  it('allows the body swipe on mobile list view', () => {
    expect(shouldHandleMobileListSwipe(base)).toBe(true)
  })

  it('blocks the body swipe when in board mode (column carousel owns the gesture)', () => {
    expect(shouldHandleMobileListSwipe({ ...base, isBoardMode: true })).toBe(false)
  })

  it('blocks the body swipe when the mobile sidebar is open', () => {
    expect(shouldHandleMobileListSwipe({ ...base, showMobileSidebar: true })).toBe(false)
  })

  it('blocks the body swipe when not on the mobile list view', () => {
    expect(shouldHandleMobileListSwipe({ ...base, mobileView: 'task' })).toBe(false)
  })

  it('blocks the body swipe on desktop', () => {
    expect(shouldHandleMobileListSwipe({ ...base, isMobile: false })).toBe(false)
  })
})
