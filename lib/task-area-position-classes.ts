/**
 * Positioning classes for MainContent's task-area wrapper — the element that
 * owns the height every task surface below it sizes against.
 *
 * It exists because the wrapper used to carry `relative` AND `absolute` at
 * once. Tailwind emits `.absolute` before `.relative`, so `relative` silently
 * won and the wrapper the code meant to stretch between its parent's top and
 * bottom became an auto-height box in normal flow. On desktop that is
 * invisible: the wrapper is `flex-1` inside a bounded flex row, so it is
 * bounded either way. On mobile the BOARD inherits the unbounded height —
 * its `h-full` columns and their `flex-1 overflow-y-auto` bodies have nothing
 * to size against, so they grow to fit their cards instead of scrolling, and
 * everything past the fold is unreachable because the app locks body scroll.
 *
 * Measured on an iPhone 12 viewport (390x664), mobile board view:
 *
 *              before          after
 *   wrapper    1975px tall     600px tall
 *   board      bottom y=2039   bottom y=664 (the screen)
 *   column     scrollHeight === clientHeight (1808) — never scrolled
 *              → clientHeight 433 against scrollHeight 1808 — scrolls
 *
 * MOBILE LIST VIEW STAYS ON `relative` (in flow), but it must be BOUNDED
 * (`h-full`, AWTD-1307). Auto height let it take its height from
 * `.mobile-task-list-container`'s `max-height: 100dvh` cap — a full screen
 * tall, starting below the body's padding for the floating header
 * (`.app-body-with-floating-header`, task 8c090700). So it overhung the screen
 * by exactly the header's height, and `.app-container` (`overflow-x: hidden`,
 * which computes overflow-y to `auto`) became a scroller with that range.
 * Flicking past the end of a list chained into it and carried the fixed header
 * off the top of the screen, where it stayed. Measured on a 390x664 iPhone:
 *
 *              before          after
 *   wrapper    top 73, h 664   top 73, h 591
 *   shell      scroll range 73 scroll range 0
 *   header     top -65 after   top 8, always
 *              a flick to the
 *              list's end
 */
export function taskAreaPositionClasses({
  isMobile,
  boardMode,
}: {
  /** The 1-column mobile layout. */
  isMobile: boolean
  /** The list has a project board AND the board surface is showing. */
  boardMode: boolean
}): string {
  // Desktop: a flex child of the app body, bounded by the flex row.
  if (!isMobile) return 'relative flex-1 min-w-0'

  // Mobile board: pinned top-to-bottom of the (bounded) parent, which is what
  // gives the columns a definite height to scroll inside.
  if (boardMode) return 'absolute inset-x-0 bottom-0'

  // Mobile list: in flow, but as tall as the body's content box and no taller
  // (AWTD-1307). See the header comment.
  return 'relative h-full'
}

/**
 * Should the app body carry `.app-body-with-floating-header` (task 6443e6a2)?
 *
 * That class exists to clear the MOBILE floating header, which is
 * `position: fixed` and takes no space in flow. The header only floats when
 * `isMobile && showHamburgerMenu` (TaskManagerHeader's `isFloating`) — but the
 * body used to pad whenever `isIOSDrawer`, which is `showHamburgerMenu ||
 * isBoardMode`. On an iPad (and any desktop window) in board view the header
 * is a normal in-flow bordered bar, so the padding stacked ON TOP of the
 * header's real height — a ~70px band of empty background between the header
 * and the board columns.
 *
 * One predicate, matching the header's own floating condition, so the two can
 * no longer disagree: pad exactly when the header floats.
 */
export function bodyClearsFloatingHeader({
  isMobile,
  isIOSDrawer,
}: {
  isMobile: boolean
  /** TaskManagerView passes this as the header's showHamburgerMenu. */
  isIOSDrawer: boolean
}): boolean {
  return isMobile && isIOSDrawer
}
