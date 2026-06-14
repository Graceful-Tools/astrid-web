import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TaskManagerHeader } from '@/components/TaskManager/Header/TaskManagerHeader'

// Mock props for TaskManagerHeader
const mockProps = {
  isMobile: false,
  showHamburgerMenu: false,
  mobileView: 'list' as const,
  lists: [
    { id: 'list-1', name: 'Test List', color: '#blue', privacy: 'PRIVATE' as const, taskCount: 5 }
  ],
  selectedListId: 'list-1',
  selectedTask: null,
  effectiveSession: { user: { id: 'user-1', email: 'test@example.com' } },
  mobileSearchMode: false,
  searchValue: '',
  toggleMobileSidebar: vi.fn(),
  handleMobileBack: vi.fn(),
  onLogoClick: vi.fn(),
  handleMobileSearchStart: vi.fn(),
  handleMobileSearchEnd: vi.fn(),
  handleMobileSearchClear: vi.fn(),
  handleMobileSearchKeyDown: vi.fn(),
  onSearchChange: vi.fn(),
  setShowSettingsPopover: vi.fn(),
  onShowKeyboardShortcuts: vi.fn(),
  isTaskDragActive: false,
  onHamburgerDragHover: vi.fn(),
}

describe('Header Home Text Removal', () => {
  it('should NOT display "Home" text in desktop header (2-column and 3-column views)', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={false} />
    )

    // Verify "Home" text is not present anywhere in the header
    expect(container.textContent).not.toContain('Home')

    // Verify no element contains "Home" as text content
    const homeSpans = Array.from(container.querySelectorAll('span')).filter(
      span => span.textContent === 'Home'
    )
    expect(homeSpans.length).toBe(0)

    // Verify the home indicator container was completely removed
    const homeIndicators = container.querySelectorAll('.theme-count-bg')
    expect(homeIndicators.length).toBe(0)
  })

  it('renders no top header bar in 3-column/desktop view — logo moved to sidebar (task 3fa1be3a)', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={false} showHamburgerMenu={false} />
    )

    // The desktop/3-column top header is removed entirely; the astrid logo now
    // lives at the top of the left sidebar rather than in a top bar.
    expect(container).toBeEmptyDOMElement()
    expect(container.querySelector('img[alt="Astrid"]')).toBeNull()
  })

  it('should not affect mobile header behavior', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={true} showHamburgerMenu={true} />
    )

    // Mobile header should not have "Home" text anyway, but verify it still works normally
    expect(container.textContent).not.toContain('Home')

    // Verify mobile header shows list name instead
    expect(container.textContent).toContain('Test List')
  })

  it('should verify file-level removal of Home text pattern', () => {
    // This test reads the actual component files to ensure the Home text was removed
    const fs = require('fs')
    const path = require('path')

    const headerFilePath = path.join(process.cwd(), 'components/TaskManager/Header/TaskManagerHeader.tsx')
    const fileContent = fs.readFileSync(headerFilePath, 'utf-8')

    // Verify the specific Home text pattern was removed
    expect(fileContent).not.toMatch(/<span className="text-sm">Home<\/span>/)

    // Verify the home indicator container structure was removed
    expect(fileContent).not.toMatch(/theme-count-bg.*Home/)

    // The logo (with its "Go to Home" affordance) moved to the left sidebar.
    const sidebarFilePath = path.join(process.cwd(), 'components/TaskManager/Sidebar/LeftSidebar.tsx')
    const sidebarContent = fs.readFileSync(sidebarFilePath, 'utf-8')
    expect(sidebarContent).toContain('title="Go to Home"')
  })

  it('renders the hamburger header (not the desktop bar) when the hamburger menu is shown', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={false} showHamburgerMenu={true} />
    )

    // 2-column/1-column still render the hamburger header with the list name…
    expect(container.querySelector('.app-header')).toBeTruthy()
    expect(container.textContent).toContain('Test List')
    // …and never the standalone astrid logo (that's the sidebar's job now).
    expect(container.querySelector('img[alt="Astrid"]')).toBeNull()
  })
})
