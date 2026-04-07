import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskManagerHeader } from '@/components/TaskManager/Header/TaskManagerHeader'
import type { TaskList } from '@/types/task'

// Create a mock function that we can control
const mockUseMyTasksPreferences = vi.fn()

// Mock useMyTasksPreferences hook
vi.mock('@/hooks/useMyTasksPreferences', () => ({
  useMyTasksPreferences: () => mockUseMyTasksPreferences()
}))

// Set default mock return value
beforeEach(() => {
  mockUseMyTasksPreferences.mockReturnValue({
    filters: {
      priority: [],
      assignee: [],
      dueDate: 'all',
      completion: 'default',
      sortBy: 'auto',
      manualSortOrder: []
    },
    setters: {},
    hasActiveFilters: false,
    clearAllFilters: vi.fn(),
    isLoading: false
  })
})

describe('TaskManagerHeader - List Name Truncation', () => {
  const mockLists: TaskList[] = [
    {
      id: 'short-list',
      name: 'Short',
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerId: 'user1',
      isPublic: false,
      color: null,
      listImageUrl: null,
      backgroundImageUrl: null,
      listImageStorageId: null,
      backgroundImageStorageId: null,
    },
    {
      id: 'long-list',
      name: 'This is a very long list name that should definitely truncate with ellipsis instead of wrapping',
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerId: 'user1',
      isPublic: false,
      color: null,
      listImageUrl: null,
      backgroundImageUrl: null,
      listImageStorageId: null,
      backgroundImageStorageId: null,
    },
  ]

  // Mock session matching list owner for settings access
  const mockSession = {
    user: {
      id: 'user1',
      email: 'test@example.com',
      name: 'Test User',
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }

  const defaultProps = {
    isMobile: true,
    showHamburgerMenu: true,
    mobileView: 'list' as const,
    lists: mockLists,
    selectedListId: 'short-list',
    selectedTask: null,
    effectiveSession: mockSession,
    mobileSearchMode: false,
    searchValue: '',
    toggleMobileSidebar: () => {},
    handleMobileBack: () => {},
    onLogoClick: () => {},
    handleMobileSearchStart: () => {},
    handleMobileSearchEnd: () => {},
    handleMobileSearchClear: () => {},
    handleMobileSearchKeyDown: () => {},
    onSearchChange: () => {},
    setShowSettingsPopover: () => {},
    onShowKeyboardShortcuts: () => {},
    isTaskDragActive: false,
    onHamburgerDragHover: () => {},
  }

  it('should render short list name without truncation classes causing issues', () => {
    render(<TaskManagerHeader {...defaultProps} selectedListId="short-list" />)

    const listNameElement = screen.getByText('Short')
    expect(listNameElement).toBeInTheDocument()
    expect(listNameElement).toHaveClass('truncate')
    expect(listNameElement).toHaveClass('inline-block')
    expect(listNameElement).toHaveClass('max-w-full')
  })

  it('should render long list name with truncation classes', () => {
    render(<TaskManagerHeader {...defaultProps} selectedListId="long-list" />)

    const listNameElement = screen.getByText(/This is a very long list name/)
    expect(listNameElement).toBeInTheDocument()
    expect(listNameElement).toHaveClass('truncate')
    expect(listNameElement).toHaveClass('inline-block')
    expect(listNameElement).toHaveClass('max-w-full')
  })

  it('should have parent container with min-w-0 to allow shrinking', () => {
    const { container } = render(<TaskManagerHeader {...defaultProps} selectedListId="long-list" />)

    // Find the center container with flex-1 and min-w-0
    const centerContainer = container.querySelector('.flex-1.min-w-0')
    expect(centerContainer).toBeInTheDocument()
    expect(centerContainer).toHaveClass('flex-1')
    expect(centerContainer).toHaveClass('min-w-0')
  })

  it('should render "My Tasks" for my-tasks special list', () => {
    render(<TaskManagerHeader {...defaultProps} selectedListId="my-tasks" />)

    const listNameElement = screen.getByText('My Tasks')
    expect(listNameElement).toBeInTheDocument()
    expect(listNameElement).toHaveClass('truncate')
  })

  it('should render "astrid" when no list is selected', () => {
    render(<TaskManagerHeader {...defaultProps} selectedListId="" />)

    const listNameElement = screen.getByText('astrid')
    expect(listNameElement).toBeInTheDocument()
    expect(listNameElement).toHaveClass('truncate')
  })

  it('should hide list name when in mobile search mode and show settings icon', () => {
    render(<TaskManagerHeader {...defaultProps} mobileSearchMode={true} isSearchActive={true} selectedListId="short-list" />)

    // List name should not be visible when in search mode
    expect(screen.queryByText('Short')).not.toBeInTheDocument()

    // But settings icon should still be visible
    const settingsButtons = screen.getAllByRole('button')
    const hasSettingsIcon = settingsButtons.some(button =>
      button.querySelector('svg.lucide-settings') || button.querySelector('svg.lucide-filter')
    )
    expect(hasSettingsIcon).toBe(true)
  })

  it('should hide list name when search value is active and show settings icon', () => {
    render(<TaskManagerHeader {...defaultProps} searchValue="test query" isSearchActive={true} selectedListId="short-list" />)

    // List name should not be visible when search is active
    expect(screen.queryByText('Short')).not.toBeInTheDocument()

    // But settings icon should still be visible
    const settingsButtons = screen.getAllByRole('button')
    const hasSettingsIcon = settingsButtons.some(button =>
      button.querySelector('svg.lucide-settings') || button.querySelector('svg.lucide-filter')
    )
    expect(hasSettingsIcon).toBe(true)
  })

  it('should not apply truncation to desktop logo view', () => {
    render(<TaskManagerHeader {...defaultProps} isMobile={false} showHamburgerMenu={false} />)

    const astridLogo = screen.getByText('astrid')
    // Desktop logo should not have truncate class
    expect(astridLogo).not.toHaveClass('truncate')
  })

  it('should handle empty list name gracefully', () => {
    const listsWithEmpty: TaskList[] = [
      {
        id: 'empty-list',
        name: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: 'user1',
        isPublic: false,
        color: null,
        listImageUrl: null,
        backgroundImageUrl: null,
        listImageStorageId: null,
        backgroundImageStorageId: null,
      },
    ]

    const { container } = render(<TaskManagerHeader {...defaultProps} lists={listsWithEmpty} selectedListId="empty-list" />)

    // Should render with truncation classes even if empty - find the span with truncate class
    const truncateSpan = container.querySelector('span.truncate')
    expect(truncateSpan).toBeInTheDocument()
    expect(truncateSpan).toHaveClass('inline-block')
    expect(truncateSpan).toHaveClass('max-w-full')
  })

  it('should always show settings icon on right side in mobile list view', () => {
    render(<TaskManagerHeader {...defaultProps} selectedListId="long-list" />)

    // Settings icon should be visible
    const settingsButtons = screen.getAllByRole('button')
    const hasSettingsIcon = settingsButtons.some(button =>
      button.querySelector('svg.lucide-settings') || button.querySelector('svg.lucide-filter')
    )
    expect(hasSettingsIcon).toBe(true)
  })

  it('should maintain settings icon visibility with long list names', () => {
    const { container } = render(<TaskManagerHeader {...defaultProps} selectedListId="long-list" />)

    // List name should truncate
    const listNameElement = screen.getByText(/This is a very long list name/)
    expect(listNameElement).toHaveClass('truncate')

    // Settings icon should still be visible
    const settingsButtons = screen.getAllByRole('button')
    const hasSettingsIcon = settingsButtons.some(button =>
      button.querySelector('svg.lucide-settings') || button.querySelector('svg.lucide-filter')
    )
    expect(hasSettingsIcon).toBe(true)

    // Right container should not shrink
    const rightContainer = container.querySelector('.flex-shrink-0:has(svg.lucide-settings), .flex-shrink-0:has(svg.lucide-filter)')
    expect(rightContainer).toBeInTheDocument()
  })

  // Regression test for priority 0 filter display
  it('should display priority 0 filter with ○ symbol in gray color for My Tasks', () => {
    render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[0]}
        myTasksFilterDueDate="all"
      />
    )

    // Should show "My Tasks - ○ Only"
    const headerElement = screen.getByText(/My Tasks/)
    expect(headerElement).toBeInTheDocument()

    // Check for ○ symbol with gray color
    const { container } = render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[0]}
        myTasksFilterDueDate="all"
      />
    )

    const grayCircleSymbol = container.querySelector('span.text-gray-400')
    expect(grayCircleSymbol).toBeInTheDocument()
    expect(grayCircleSymbol?.textContent).toBe('○')
  })

  it('should display priority 0 filter with date filter for My Tasks', () => {
    const { container } = render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[0]}
        myTasksFilterDueDate="today"
      />
    )

    // Should show "My Tasks - Today ○ Only"
    expect(screen.getByText(/My Tasks/)).toBeInTheDocument()
    expect(screen.getByText(/Today/)).toBeInTheDocument()

    // Check for ○ symbol with gray color
    const grayCircleSymbol = container.querySelector('span.text-gray-400')
    expect(grayCircleSymbol).toBeInTheDocument()
    expect(grayCircleSymbol?.textContent).toBe('○')
  })

  it('should display other priority filters with correct colors', () => {
    // Test priority 3 (!!!)
    const { container: container3 } = render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[3]}
        myTasksFilterDueDate="all"
      />
    )
    const priority3Symbol = container3.querySelector('span.text-red-500')
    expect(priority3Symbol).toBeInTheDocument()
    expect(priority3Symbol?.textContent).toBe('!!!')

    // Test priority 2 (!!)
    const { container: container2 } = render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[2]}
        myTasksFilterDueDate="all"
      />
    )
    const priority2Symbol = container2.querySelector('span.text-orange-500')
    expect(priority2Symbol).toBeInTheDocument()
    expect(priority2Symbol?.textContent).toBe('!!')

    // Test priority 1 (!)
    const { container: container1 } = render(
      <TaskManagerHeader
        {...defaultProps}
        selectedListId="my-tasks"
        myTasksFilterPriority={[1]}
        myTasksFilterDueDate="all"
      />
    )
    const priority1Symbol = container1.querySelector('span.text-blue-500')
    expect(priority1Symbol).toBeInTheDocument()
    expect(priority1Symbol?.textContent).toBe('!')
  })
})

describe('TaskManagerHeader - My Tasks Filter Indicators', () => {
  const mockLists: TaskList[] = []

  const mockSession = {
    user: {
      id: 'user1',
      email: 'test@example.com',
      name: 'Test User',
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }

  const defaultProps = {
    isMobile: true,
    showHamburgerMenu: true,
    mobileView: 'list' as const,
    lists: mockLists,
    selectedListId: 'my-tasks',
    selectedTask: null,
    effectiveSession: mockSession,
    mobileSearchMode: false,
    searchValue: '',
    toggleMobileSidebar: () => {},
    handleMobileBack: () => {},
    onLogoClick: () => {},
    handleMobileSearchStart: () => {},
    handleMobileSearchEnd: () => {},
    handleMobileSearchClear: () => {},
    handleMobileSearchKeyDown: () => {},
    onSearchChange: () => {},
    setShowSettingsPopover: () => {},
    onShowKeyboardShortcuts: () => {},
    isTaskDragActive: false,
    onHamburgerDragHover: () => {},
  }

  it('should show "My Tasks" without filters when no filters are active', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [],
        dueDate: 'all',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: false,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    render(<TaskManagerHeader {...defaultProps} />)
    const titleElement = screen.getByText('My Tasks')
    expect(titleElement).toBeInTheDocument()
  })

  it('should show "My Tasks - This Week" when date filter is active', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [],
        dueDate: 'this_week',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: true,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    render(<TaskManagerHeader {...defaultProps} />)
    const titleElement = screen.getByText(/My Tasks - This Week/)
    expect(titleElement).toBeInTheDocument()
  })

  it('should show "My Tasks - !! Only" when priority filter is active', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [2],
        dueDate: 'all',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: true,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    const { container } = render(<TaskManagerHeader {...defaultProps} />)

    // Check for the text components - they're split across spans, so check container text content
    const headerContent = container.textContent
    expect(headerContent).toContain('My Tasks')
    expect(headerContent).toContain('!!')
    expect(headerContent).toContain('Only')
  })

  it('should show "My Tasks - Today !!! Only" when both filters are active', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [3],
        dueDate: 'today',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: true,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    const { container } = render(<TaskManagerHeader {...defaultProps} />)

    // Check for the text components - they're split across spans, so check container text content
    const headerContent = container.textContent
    expect(headerContent).toContain('My Tasks')
    expect(headerContent).toContain('Today')
    expect(headerContent).toContain('!!!')
    expect(headerContent).toContain('Only')
  })

  it('should apply priority colors to priority indicators', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [3],
        dueDate: 'all',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: true,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    const { container } = render(<TaskManagerHeader {...defaultProps} />)

    // Check that the priority indicator has a color class
    const redTextElements = container.querySelectorAll('.text-red-500')
    expect(redTextElements.length).toBeGreaterThan(0)

    // Verify the colored element contains the priority indicator
    const priorityIndicator = Array.from(redTextElements).find(el => el.textContent === '!!!')
    expect(priorityIndicator).toBeTruthy()
  })

  it('should not show filter indicators for non-my-tasks lists', () => {
    mockUseMyTasksPreferences.mockReturnValue({
      filters: {
        priority: [3],
        dueDate: 'today',
        completion: 'default',
        sortBy: 'auto',
      },
      setters: {},
      hasActiveFilters: true,
      clearAllFilters: vi.fn(),
      isLoading: false,
    })

    const listsWithRegular: TaskList[] = [
      {
        id: 'regular-list',
        name: 'Regular List',
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: 'user1',
        isPublic: false,
        color: null,
        listImageUrl: null,
        backgroundImageUrl: null,
        listImageStorageId: null,
        backgroundImageStorageId: null,
      },
    ]

    render(<TaskManagerHeader {...defaultProps} lists={listsWithRegular} selectedListId="regular-list" />)

    // Should show just the list name without filters
    const titleElement = screen.getByText('Regular List')
    expect(titleElement).toBeInTheDocument()
    expect(screen.queryByText(/Today/)).not.toBeInTheDocument()
    expect(screen.queryByText(/!!!/)).not.toBeInTheDocument()
  })
})
