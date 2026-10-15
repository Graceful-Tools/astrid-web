/**
 * Pure geometry for the inline task panel's left offset, extracted from
 * TaskManagerView's resize effect (god-file extraction, Stage pattern).
 *
 * The DOM reads (getBoundingClientRect) stay in the component; this is just the
 * layout math, so it can be reasoned about and unit-tested in isolation.
 */
export interface TaskPaneLayout {
  is2Column: boolean
  is3Column: boolean
  showHamburgerMenu: boolean
}

/** Gap (px) between the main content and the inline task panel. */
export const TASK_PANE_GAP = 20

/**
 * `.task-panel-desktop`'s own `min-width: var(--task-panel-min-width)`
 * (styles/components.css). Duplicated here because the clamp below has to know
 * it: change one and change the other.
 */
export const TASK_PANE_MIN_WIDTH = 350

/** The render site applies `left: offset - 18`. */
export const TASK_PANE_LEFT_NUDGE = 18

/** ...and pins the panel's right edge this far from the viewport's. */
export const TASK_PANE_RIGHT_INSET = 10

/**
 * Compute the task panel's left offset given the measured sidebar / main-content
 * widths and the current layout:
 * - 2-column: sidebar is a hamburger overlay → panel sits after main content.
 * - 3-column: panel sits after the visible sidebar + main content.
 * - otherwise: fall back to the hamburger flag.
 *
 * `viewportWidth` keeps the panel ON SCREEN (AWTD-1205). The panel is
 * `position: fixed`, rendered as `left: offset - 18; right: 10; width: auto` —
 * and `width: auto` would shrink it to fit, except `min-width: 350px`
 * overrules that. So past the point where 350px still fits, the panel does not
 * narrow: it extends past the right edge, and the detail you opened is simply
 * not on screen. That is what hiding the messages panel does — the main content
 * expands into the space it vacated, and this offset grows with it.
 *
 * Omitting `viewportWidth` leaves every answer exactly as it was. The caller
 * measures the window, and there is nothing to clamp against without that
 * reading; inventing one would move the panel during a server render.
 */
export function computeTaskPaneLeftOffset(
  sidebarWidth: number,
  mainWidth: number,
  layout: TaskPaneLayout,
  viewportWidth?: number,
): number {
  const ideal = layout.is2Column
    ? mainWidth + TASK_PANE_GAP
    : layout.is3Column || !layout.showHamburgerMenu
      ? sidebarWidth + mainWidth + TASK_PANE_GAP
      : mainWidth + TASK_PANE_GAP

  if (!viewportWidth || viewportWidth <= 0) return ideal

  // The furthest left the panel can start and still show its minimum width.
  const maxLeft = viewportWidth - TASK_PANE_RIGHT_INSET - TASK_PANE_MIN_WIDTH + TASK_PANE_LEFT_NUDGE
  // A viewport narrower than the panel's minimum cannot satisfy both; pin it to
  // the left edge, where at least the panel is reachable.
  return Math.max(0, Math.min(ideal, maxLeft))
}
