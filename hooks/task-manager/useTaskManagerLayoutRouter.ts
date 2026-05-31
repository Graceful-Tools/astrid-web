import { useMemo } from 'react'

/**
 * Which surface fills the main content column.
 * - `settings`  — the Settings panel (+ optional second pane on wide layouts)
 * - `mobileChat`— messages replace the task surface (mobile / board only)
 * - `content`   — the normal task list / board (MainContent)
 */
export type TaskManagerMainSurface = 'settings' | 'mobileChat' | 'content'

/**
 * Raw layout-relevant state TaskManagerView already holds. Booleans like
 * `hasUser` / `hasSelectedTask` are passed pre-derived so the router stays a
 * pure function of primitives and is trivially testable.
 */
export interface TaskManagerLayoutRouterInput {
  isMobile: boolean
  isBoardMode: boolean
  is1Column: boolean
  is2Column: boolean
  is3Column: boolean
  isSettingsActive: boolean
  isSettingsPaneClosing: boolean
  settingsSubPage: string | null
  isSearchActive: boolean
  activePanel: 'tasks' | 'chat'
  mobileView: 'list' | 'task' | 'chat'
  taskViewMode: 'list' | 'board'
  showHamburgerMenu: boolean
  hasUser: boolean
  hasSelectedTask: boolean
  isTaskPaneClosing: boolean
  isMobileTaskDetailClosing: boolean
}

/**
 * The resolved render decisions. Each flag maps 1:1 to a branch in
 * TaskManagerView's render so the view becomes "render what the router says".
 */
export interface TaskManagerLayoutDecisions {
  /** Sidebar is overlaid as an iOS-style drawer rather than docked. */
  isIOSDrawer: boolean
  /** Which surface fills the main content column. */
  mainSurface: TaskManagerMainSurface
  /** Settings shows its illustrated second pane (wide layouts). */
  showSettingsSecondPane: boolean
  /** The inline chat column on the right (2/3-column, non-board, non-settings). */
  showDesktopChatPanel: boolean
  /** Floating settings detail pane on the right (desktop). */
  showDesktopSettingsDetailPane: boolean
  /** Floating task detail pane on the right (desktop). */
  showDesktopTaskPane: boolean
  /** Full-screen settings detail pane (mobile). */
  showMobileSettingsDetailPane: boolean
  /** Full-screen task detail pane (mobile). */
  showMobileTaskPane: boolean
}

/**
 * Resolves TaskManagerView's render matrix (isMobile × isBoardMode ×
 * selectedTask × settingsSubPage × isSearchActive × mobileView × activePanel ×
 * column-count) into a flat set of decisions. Extracted from the 390-line
 * conditional slab in TaskManagerView.tsx (Stage 19) with no behavior change —
 * each decision reproduces the exact condition it replaced.
 */
export function useTaskManagerLayoutRouter(
  input: TaskManagerLayoutRouterInput
): TaskManagerLayoutDecisions {
  const {
    isMobile,
    isBoardMode,
    is1Column,
    is2Column,
    is3Column,
    isSettingsActive,
    isSettingsPaneClosing,
    settingsSubPage,
    isSearchActive,
    activePanel,
    mobileView,
    taskViewMode,
    showHamburgerMenu,
    hasUser,
    hasSelectedTask,
    isTaskPaneClosing,
    isMobileTaskDetailClosing,
  } = input

  return useMemo(() => {
    const isIOSDrawer = showHamburgerMenu || isBoardMode

    const mainSurface: TaskManagerMainSurface = isSettingsActive
      ? 'settings'
      : activePanel === 'chat' && (isMobile || isBoardMode) && !isSearchActive
        ? 'mobileChat'
        : 'content'

    return {
      isIOSDrawer,
      mainSurface,
      showSettingsSecondPane: isSettingsActive && (is3Column || is2Column),
      showDesktopChatPanel:
        (is3Column || is2Column) && hasUser && !isSettingsActive && taskViewMode !== 'board',
      showDesktopSettingsDetailPane:
        !is1Column && (Boolean(settingsSubPage) || isSettingsPaneClosing) && isSettingsActive,
      showDesktopTaskPane:
        !is1Column &&
        !isBoardMode &&
        hasSelectedTask &&
        hasUser &&
        (!isSettingsActive || isTaskPaneClosing),
      showMobileSettingsDetailPane: isMobile && Boolean(settingsSubPage) && isSettingsActive,
      showMobileTaskPane:
        isMobile &&
        !isBoardMode &&
        !isSettingsActive &&
        hasSelectedTask &&
        hasUser &&
        (mobileView === 'task' || isMobileTaskDetailClosing),
    }
  }, [
    isMobile,
    isBoardMode,
    is1Column,
    is2Column,
    is3Column,
    isSettingsActive,
    isSettingsPaneClosing,
    settingsSubPage,
    isSearchActive,
    activePanel,
    mobileView,
    taskViewMode,
    showHamburgerMenu,
    hasUser,
    hasSelectedTask,
    isTaskPaneClosing,
    isMobileTaskDetailClosing,
  ])
}
