/**
 * @vitest-environment jsdom
 *
 * AWTD-1163: the desktop sidebar opens and closes from an icon, as on Mac.
 *
 *   - a "Hide sidebar" button in the sidebar's own header collapses it;
 *   - collapsed, it is a slim rail holding only "Show sidebar" — nothing
 *     floats over the list's title;
 *   - the choice is remembered in this browser, and survives storage that
 *     throws (private windows);
 *   - the mobile / 2-column drawer is untouched (it has its own hamburger).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import { LeftSidebar } from '@/components/TaskManager/Sidebar/LeftSidebar'
import { SIDEBAR_COLLAPSED_KEY, setSidebarCollapsed } from '@/hooks/task-manager/useSidebarCollapsed'

const props: any = {
  isMobile: false,
  showHamburgerMenu: false,
  showMobileSidebar: false,
  sidebarRef: { current: null },
  effectiveSession: { user: { id: 'u1', name: 'U', email: 'u@example.com' } },
  lists: [],
  publicLists: [],
  collaborativePublicLists: [],
  suggestedPublicLists: [],
  selectedListId: 'my-tasks',
  getFixedListTaskCountMemo: () => 0,
  getSavedFilterTaskCountMemo: () => 0,
  getTaskCountForListMemo: () => 0,
  setSelectedListId: vi.fn(),
  setShowMobileSidebar: vi.fn(),
  setShowAddListModal: vi.fn(),
  setShowPublicBrowser: vi.fn(),
  setShowSettingsPopover: vi.fn(),
  onTaskDropOnList: vi.fn(),
  onTaskDragEnter: vi.fn(),
  onTaskDragLeave: vi.fn(),
  onTaskDragOver: vi.fn(),
}

beforeEach(() => {
  window.localStorage.clear()
  act(() => setSidebarCollapsed(false))
})

describe('collapsible desktop sidebar (AWTD-1163)', () => {
  it('collapses to a rail with only "Show sidebar", and expands again', () => {
    render(<LeftSidebar {...props} />)
    expect(screen.getByText(/search/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(screen.queryByText(/search/i)).toBeNull()
    expect(screen.getByTestId('sidebar-rail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(screen.getByText(/search/i)).toBeInTheDocument()
  })

  it('remembers the choice in this browser', () => {
    render(<LeftSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')
  })

  it('still works when storage throws (a private window)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    render(<LeftSidebar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(screen.getByTestId('sidebar-rail')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('leaves the mobile / 2-column drawer alone', () => {
    act(() => setSidebarCollapsed(true))
    render(<LeftSidebar {...props} showHamburgerMenu />)
    expect(screen.queryByTestId('sidebar-rail')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide sidebar' })).toBeNull()
  })
})
