export type MobileHeaderMode =
  | 'desktop'
  | 'mobile-list-with-menu'
  | 'mobile-list-with-back'

export interface MobileHeaderModeState {
  /** True when the layout is a 1-column mobile layout. */
  isMobile: boolean
  /** True when the layout shows the hamburger menu (mobile + narrow desktop). */
  showHamburgerMenu: boolean
  /** Current pane the mobile shell is on. */
  mobileView: 'list' | 'task' | 'chat'
  /** True during the task detail close animation. */
  isMobileTaskDetailClosing: boolean
}

/**
 * Decide what shape the top header should take.
 *
 * Bug history (35c1ad50): mobile 1-column previously switched the header
 * title from the list name to the *task* title whenever you tapped a task
 * row. The list name should stay put — only the leading button flips
 * (hamburger ↔ back arrow) to reflect the navigation state.
 */
export function getMobileHeaderMode(state: MobileHeaderModeState): MobileHeaderMode {
  if (!state.showHamburgerMenu) return 'desktop'
  if (
    state.isMobile &&
    state.mobileView === 'task' &&
    !state.isMobileTaskDetailClosing
  ) {
    return 'mobile-list-with-back'
  }
  return 'mobile-list-with-menu'
}
