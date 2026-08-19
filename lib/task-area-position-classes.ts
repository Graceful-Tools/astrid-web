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
 * MOBILE LIST VIEW IS LEFT ON `relative` DELIBERATELY. It renders correctly
 * today precisely because it lands there, with `.mobile-task-list-container`
 * capping itself at `max-height: 100dvh` (styles/components.css). Flipping it
 * to `absolute` as well would be a rewrite of a layout nobody reported as
 * broken. The list branch drops only `inset-x-0 bottom-0`, which are inert on a
 * relatively-positioned element (`left`/`right`/`bottom` of 0 shift it by 0),
 * so the rendered result is byte-for-byte today's.
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

  // Mobile list: unchanged.
  return 'relative'
}
