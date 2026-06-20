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
 * Compute the task panel's left offset given the measured sidebar / main-content
 * widths and the current layout:
 * - 2-column: sidebar is a hamburger overlay → panel sits after main content.
 * - 3-column: panel sits after the visible sidebar + main content.
 * - otherwise: fall back to the hamburger flag.
 */
export function computeTaskPaneLeftOffset(
  sidebarWidth: number,
  mainWidth: number,
  layout: TaskPaneLayout,
): number {
  if (layout.is2Column) {
    return mainWidth + TASK_PANE_GAP
  }
  if (layout.is3Column) {
    return sidebarWidth + mainWidth + TASK_PANE_GAP
  }
  return layout.showHamburgerMenu
    ? mainWidth + TASK_PANE_GAP
    : sidebarWidth + mainWidth + TASK_PANE_GAP
}
