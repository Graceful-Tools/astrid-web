export type MobileHeaderMode = 'desktop' | 'mobile-list-with-menu'

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
 * row, and the leading button flipped from hamburger to back arrow. Neither
 * is needed — back navigation is handled by swipe-right and the in-pane
 * close. The header stays the same across list/task/chat views.
 */
export function getMobileHeaderMode(state: MobileHeaderModeState): MobileHeaderMode {
  if (!state.showHamburgerMenu) return 'desktop'
  // Suppress unused-state warnings: kept in the signature for future modes
  // (e.g. when we want a different leading affordance in a specific view).
  void state.isMobile
  void state.mobileView
  void state.isMobileTaskDetailClosing
  return 'mobile-list-with-menu'
}
