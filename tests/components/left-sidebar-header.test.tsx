/**
 * @vitest-environment jsdom
 *
 * The sidebar's brand header, rendered (ADEV-296). Replaces three source-pin
 * files that read LeftSidebar.tsx as text: sidebar-header-search (AWTD-1180),
 * sidebar-header-notifications (AWTD-1357) and the sidebar half of
 * a11y-landmarks (AWTD-1435).
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import { LeftSidebar } from '@/components/TaskManager/Sidebar/LeftSidebar'

function makeProps(overrides: Record<string, unknown> = {}): any {
  return {
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
    onSelectSearch: vi.fn(),
    onLogoClick: vi.fn(),
    ...overrides,
  }
}

describe('sidebar brand header', () => {
  it('has a search control that opens search through the same handler as the nav row (AWTD-1180)', () => {
    const onSelectSearch = vi.fn()
    render(<LeftSidebar {...makeProps({ onSelectSearch })} />)

    const icon = screen.getByRole('button', { name: 'Search' })
    expect(icon).toHaveAttribute('title', 'Search')
    fireEvent.click(icon)
    expect(onSelectSearch).toHaveBeenCalledTimes(1)

    // The nav row stays: the icon is an addition, not a replacement.
    const row = screen.getByText('Search for tasks and users').closest('button') as HTMLElement
    fireEvent.click(row)
    expect(onSelectSearch).toHaveBeenCalledTimes(2)
  })

  it('keeps the logo left, then the bell, then search (AWTD-1180, AWTD-1357)', () => {
    render(<LeftSidebar {...makeProps()} />)

    const logo = screen.getByRole('button', { name: 'Go to Home' })
    const bell = screen.getByTitle('Notifications')
    const search = screen.getByRole('button', { name: 'Search' })
    const before = Node.DOCUMENT_POSITION_FOLLOWING

    expect(logo.compareDocumentPosition(bell) & before).toBeTruthy()
    expect(bell.compareDocumentPosition(search) & before).toBeTruthy()
  })

  it('renders the logo as a real button that goes home (AWTD-1435)', () => {
    const onLogoClick = vi.fn()
    render(<LeftSidebar {...makeProps({ onLogoClick })} />)

    const logo = screen.getByRole('button', { name: 'Go to Home' })
    expect(logo.tagName).toBe('BUTTON')
    fireEvent.click(logo)
    expect(onLogoClick).toHaveBeenCalledTimes(1)
  })
})
