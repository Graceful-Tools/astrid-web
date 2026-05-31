import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  useTaskManagerLayoutRouter,
  type TaskManagerLayoutRouterInput,
} from '@/hooks/task-manager/useTaskManagerLayoutRouter'

/**
 * Task b8a5ba21 — Stage 19: the layout router that resolves TaskManagerView's
 * render matrix into flat decisions. These tests pin the cross-product so a
 * future refactor can't silently drop a panel or flip a condition.
 */

// A neutral desktop 3-column baseline: signed in, nothing selected, list view.
const BASE: TaskManagerLayoutRouterInput = {
  isMobile: false,
  isBoardMode: false,
  is1Column: false,
  is2Column: false,
  is3Column: true,
  isSettingsActive: false,
  isSettingsPaneClosing: false,
  settingsSubPage: null,
  isSearchActive: false,
  activePanel: 'tasks',
  mobileView: 'list',
  taskViewMode: 'list',
  showHamburgerMenu: false,
  hasUser: true,
  hasSelectedTask: false,
  isTaskPaneClosing: false,
  isMobileTaskDetailClosing: false,
}

function decide(overrides: Partial<TaskManagerLayoutRouterInput> = {}) {
  const { result } = renderHook(() =>
    useTaskManagerLayoutRouter({ ...BASE, ...overrides })
  )
  return result.current
}

describe('useTaskManagerLayoutRouter (Stage 19 / task b8a5ba21)', () => {
  describe('isIOSDrawer', () => {
    it('is true when the hamburger menu is shown', () => {
      expect(decide({ showHamburgerMenu: true }).isIOSDrawer).toBe(true)
    })
    it('is true in board mode regardless of hamburger', () => {
      expect(decide({ isBoardMode: true }).isIOSDrawer).toBe(true)
    })
    it('is false on a docked desktop layout', () => {
      expect(decide().isIOSDrawer).toBe(false)
    })
  })

  describe('mainSurface', () => {
    it('is settings whenever settings is active (wins over everything)', () => {
      expect(decide({ isSettingsActive: true, activePanel: 'chat', isMobile: true }).mainSurface)
        .toBe('settings')
    })
    it('is mobileChat when chat panel is active on mobile and not searching', () => {
      expect(decide({ isMobile: true, activePanel: 'chat' }).mainSurface).toBe('mobileChat')
    })
    it('is mobileChat when chat panel is active in board mode', () => {
      expect(decide({ isBoardMode: true, activePanel: 'chat' }).mainSurface).toBe('mobileChat')
    })
    it('is content (not mobileChat) while searching, even with chat active', () => {
      expect(decide({ isMobile: true, activePanel: 'chat', isSearchActive: true }).mainSurface)
        .toBe('content')
    })
    it('is content on desktop with the tasks panel active', () => {
      expect(decide().mainSurface).toBe('content')
    })
    it('is content when chat is active on desktop (mobileChat is mobile/board only)', () => {
      expect(decide({ activePanel: 'chat' }).mainSurface).toBe('content')
    })
  })

  describe('showSettingsSecondPane', () => {
    it('shows on a wide layout in settings', () => {
      expect(decide({ isSettingsActive: true }).showSettingsSecondPane).toBe(true)
    })
    it('hides on a 1-column layout', () => {
      expect(decide({ isSettingsActive: true, is3Column: false, is1Column: true }).showSettingsSecondPane)
        .toBe(false)
    })
    it('hides when settings is not active', () => {
      expect(decide().showSettingsSecondPane).toBe(false)
    })
  })

  describe('showDesktopChatPanel', () => {
    it('shows on wide layout, signed in, not settings, not board', () => {
      expect(decide().showDesktopChatPanel).toBe(true)
    })
    it('hides in board mode (taskViewMode board)', () => {
      expect(decide({ taskViewMode: 'board' }).showDesktopChatPanel).toBe(false)
    })
    it('hides during settings', () => {
      expect(decide({ isSettingsActive: true }).showDesktopChatPanel).toBe(false)
    })
    it('hides on a 1-column layout', () => {
      expect(decide({ is3Column: false, is1Column: true }).showDesktopChatPanel).toBe(false)
    })
  })

  describe('showDesktopSettingsDetailPane', () => {
    it('shows when a settings subpage is open on desktop in settings', () => {
      expect(decide({ isSettingsActive: true, settingsSubPage: 'profile' }).showDesktopSettingsDetailPane)
        .toBe(true)
    })
    it('shows while the settings pane is animating closed', () => {
      expect(decide({ isSettingsActive: true, isSettingsPaneClosing: true }).showDesktopSettingsDetailPane)
        .toBe(true)
    })
    it('hides on 1-column', () => {
      expect(decide({ isSettingsActive: true, settingsSubPage: 'profile', is1Column: true, is3Column: false }).showDesktopSettingsDetailPane)
        .toBe(false)
    })
  })

  describe('showDesktopTaskPane', () => {
    it('shows a selected task on desktop, not board, not settings', () => {
      expect(decide({ hasSelectedTask: true }).showDesktopTaskPane).toBe(true)
    })
    it('stays mounted during task-pane close even if settings just activated', () => {
      expect(decide({ hasSelectedTask: true, isSettingsActive: true, isTaskPaneClosing: true }).showDesktopTaskPane)
        .toBe(true)
    })
    it('hides in board mode', () => {
      expect(decide({ hasSelectedTask: true, isBoardMode: true }).showDesktopTaskPane).toBe(false)
    })
    it('hides without a signed-in user', () => {
      expect(decide({ hasSelectedTask: true, hasUser: false }).showDesktopTaskPane).toBe(false)
    })
    it('hides on 1-column (mobile pane handles that)', () => {
      expect(decide({ hasSelectedTask: true, is1Column: true, is3Column: false }).showDesktopTaskPane).toBe(false)
    })
  })

  describe('mobile panes', () => {
    it('shows the mobile task pane for a selected task in mobile task view', () => {
      const d = decide({ isMobile: true, is3Column: false, is1Column: true, hasSelectedTask: true, mobileView: 'task' })
      expect(d.showMobileTaskPane).toBe(true)
    })
    it('shows the mobile task pane while it animates closed', () => {
      const d = decide({ isMobile: true, is3Column: false, is1Column: true, hasSelectedTask: true, mobileView: 'list', isMobileTaskDetailClosing: true })
      expect(d.showMobileTaskPane).toBe(true)
    })
    it('hides the mobile task pane in board mode', () => {
      const d = decide({ isMobile: true, isBoardMode: true, hasSelectedTask: true, mobileView: 'task' })
      expect(d.showMobileTaskPane).toBe(false)
    })
    it('shows the mobile settings detail pane for a subpage in settings', () => {
      const d = decide({ isMobile: true, is3Column: false, is1Column: true, isSettingsActive: true, settingsSubPage: 'profile' })
      expect(d.showMobileSettingsDetailPane).toBe(true)
    })
  })
})
