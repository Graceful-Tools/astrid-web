import { describe, expect, it } from 'vitest'
import { getMobileHeaderMode } from '@/lib/mobile-header-mode'

const base = {
  isMobile: true,
  showHamburgerMenu: true,
  mobileView: 'list' as const,
  isMobileTaskDetailClosing: false,
}

describe('getMobileHeaderMode', () => {
  it('renders the desktop header when the hamburger menu is not active (≥ tablet-3-col)', () => {
    expect(getMobileHeaderMode({ ...base, showHamburgerMenu: false })).toBe('desktop')
  })

  it('renders the list-style header on mobile list view (hamburger + list name)', () => {
    expect(getMobileHeaderMode(base)).toBe('mobile-list-with-menu')
  })

  it('renders the list-style header on mobile task view, but with a back arrow — bug 35c1ad50: header must NOT show the task title', () => {
    expect(getMobileHeaderMode({ ...base, mobileView: 'task' })).toBe('mobile-list-with-back')
  })

  it('keeps the menu variant while the task detail is animating closed (avoid mid-flight flicker)', () => {
    expect(
      getMobileHeaderMode({ ...base, mobileView: 'task', isMobileTaskDetailClosing: true }),
    ).toBe('mobile-list-with-menu')
  })

  it('renders the list-style header for mobile chat view too (consistent header)', () => {
    expect(getMobileHeaderMode({ ...base, mobileView: 'chat' })).toBe('mobile-list-with-menu')
  })
})
