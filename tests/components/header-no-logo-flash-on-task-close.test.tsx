import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TaskManagerHeader } from '@/components/TaskManager/Header/TaskManagerHeader'

// Regression: closing the mobile task detail used to flash the desktop
// "astrid" wordmark + logo because the close-animation window left the
// header without a matching branch — mobileView was still 'task' but
// isMobileTaskDetailClosing suppressed the task header, so it fell through
// to the desktop branch.
const mobileBaseProps = {
  isMobile: true,
  showHamburgerMenu: true,
  mobileView: 'task' as const,
  lists: [
    { id: 'list-1', name: 'My List', color: '#3b82f6', privacy: 'PRIVATE' as const, taskCount: 1 },
  ],
  selectedListId: 'list-1',
  selectedTask: { id: 't1', title: 'A task', listIds: ['list-1'] },
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

describe('Header — no astrid-logo flash when closing task detail', () => {
  it('does NOT show the astrid wordmark while the close animation is running', () => {
    const { container } = render(
      <TaskManagerHeader
        {...mobileBaseProps}
        // Mid-close animation: detail is closing but mobileView hasn't flipped yet
        isMobileTaskDetailClosing={true as any}
      />
    )

    // Wordmark from the desktop fallback branch must not appear
    const wordmark = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.textContent === 'astrid',
    )
    expect(wordmark.length).toBe(0)

    // The list-header content (list name) should be visible — that's where
    // we're heading, so it should already be on screen.
    expect(container.textContent).toContain('My List')
  })

  it('shows the list name in the header in mobile task view (bug 35c1ad50: the title MUST stay as the list name, not the task title)', () => {
    const { container } = render(
      <TaskManagerHeader
        {...mobileBaseProps}
        isMobileTaskDetailClosing={false as any}
      />
    )

    // Header anchors on the list name across list/task views.
    expect(container.textContent).toContain('My List')
    // The task title is NOT rendered in the top header anymore.
    expect(container.textContent).not.toContain('A task')
    // No desktop wordmark either.
    const wordmark = Array.from(container.querySelectorAll('span')).filter(
      (s) => s.textContent === 'astrid',
    )
    expect(wordmark.length).toBe(0)
  })
})
