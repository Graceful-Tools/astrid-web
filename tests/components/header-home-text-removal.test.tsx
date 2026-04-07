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

  it('should still show astrid logo and functionality in desktop header', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={false} />
    )

    // Verify essential header elements still exist
    expect(container.textContent).toContain('astrid')

    // Verify logo image exists (now using Image component instead of lucide icon)
    const logoImage = container.querySelector('img[alt="Astrid"]')
    expect(logoImage).toBeTruthy()
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
    // This test reads the actual component file to ensure the Home text was removed
    const fs = require('fs')
    const path = require('path')

    const headerFilePath = path.join(process.cwd(), 'components/TaskManager/Header/TaskManagerHeader.tsx')
    const fileContent = fs.readFileSync(headerFilePath, 'utf-8')

    // Verify the specific Home text pattern was removed
    expect(fileContent).not.toMatch(/<span className="text-sm">Home<\/span>/)

    // Verify the home indicator container structure was removed
    expect(fileContent).not.toMatch(/theme-count-bg.*Home/)

    // Ensure we didn't accidentally remove other important "Home" references
    expect(fileContent).toContain('title="Go to Home"') // Logo should still have this title
  })

  it('should maintain header structure without Home indicator', () => {
    const { container } = render(
      <TaskManagerHeader {...mockProps} isMobile={false} />
    )

    // Verify header still has proper structure
    const headerElement = container.querySelector('.app-header')
    expect(headerElement).toBeTruthy()

    // Verify flex layout is maintained
    const flexContainer = container.querySelector('.flex.items-center.space-x-4')
    expect(flexContainer).toBeTruthy()

    // Verify essential elements are still positioned correctly (now using Image component)
    const logo = container.querySelector('img[alt="Astrid"]')
    expect(logo).toBeTruthy()
  })
})
