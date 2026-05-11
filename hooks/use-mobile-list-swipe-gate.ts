export interface MobileListSwipeGateState {
  isMobile: boolean
  // `mobileView` is whatever the layout hook returns — typed loosely so this
  // gate works for any future mode (we only fire when it is exactly 'list').
  mobileView: string
  showMobileSidebar: boolean
  isBoardMode: boolean
}

/**
 * Decide whether the body-level horizontal swipe on the task manager should
 * fire mobile navigation (open sidebar on swipe-right, switch to task view
 * on swipe-left).
 *
 * Returns `false` when the board view is active because the board's column
 * carousel owns the horizontal gesture in that mode — letting the body
 * handler fire too would change the header out from under the user.
 */
export function shouldHandleMobileListSwipe(state: MobileListSwipeGateState): boolean {
  if (!state.isMobile) return false
  if (state.mobileView !== 'list') return false
  if (state.showMobileSidebar) return false
  if (state.isBoardMode) return false
  return true
}
