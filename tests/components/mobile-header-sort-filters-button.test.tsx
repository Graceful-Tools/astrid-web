/**
 * AWTD-1356 — Sort & Filters is a funnel in the list header, beside the gear.
 *
 * Jon filed this from an iPhone: the header showed only the gear, and sort and
 * filters were two taps away inside List Settings. *"Move sort on to an icon in
 * the list header next to the gear and not in settings."* Then, on the question
 * of whether 3-column should match: *"We are moving it to the header."*
 *
 * That reverses AWTD-1175, which deliberately kept the narrow layouts on the
 * iPhone shape — one button, sort reached through the gear — and whose stated
 * reason was that "a user list's header has ONE button, the gear". By the time
 * this was filed that header carried four (hamburger, chat, bell, gear), so the
 * premise had expired along with the rule.
 *
 * This suite covers the narrow header. The 3-column header is covered in
 * tests/components/two-column-add-task-visible.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { buildTaskList } from '../fixtures/domain'
import { row } from '../fixtures/prisma-rows'
import { TaskManagerHeader } from '@/components/TaskManager/Header/TaskManagerHeader'

const mockUseMyTasksPreferences = vi.fn()
vi.mock('@/hooks/useMyTasksPreferences', () => ({
  useMyTasksPreferences: () => mockUseMyTasksPreferences(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseMyTasksPreferences.mockReturnValue(row({
    filters: { priority: [], dueDate: 'all', search: '' },
  }))
})

const lists = [buildTaskList({ id: 'list-1', name: 'Health', ownerId: 'user-1' })]

const props = {
  isMobile: true,
  showHamburgerMenu: true,
  mobileView: 'list' as const,
  lists,
  selectedListId: 'list-1',
  selectedTask: null,
  effectiveSession: { user: { id: 'user-1', email: 'a@b.c', name: 'A' } },
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

const funnel = () => document.querySelector('[data-sort-filters-button]')
const gear = () => document.querySelector('[data-settings-button]')

describe('narrow list header: Sort & Filters beside the gear (AWTD-1356)', () => {
  it('shows the funnel on a user list, where there used to be only a gear', () => {
    render(<TaskManagerHeader {...props} setShowSortFiltersFor={vi.fn()} />)

    expect(funnel()).not.toBeNull()
    expect(gear()).not.toBeNull()
  })

  it('opens Sort & Filters directly, not List Settings', () => {
    const setShowSortFiltersFor = vi.fn()
    const setShowSettingsPopover = vi.fn()
    render(
      <TaskManagerHeader
        {...props}
        setShowSortFiltersFor={setShowSortFiltersFor}
        setShowSettingsPopover={setShowSettingsPopover}
      />,
    )

    fireEvent.click(funnel()!)

    // The point of the task: it is no longer reached *through* the gear.
    expect(setShowSortFiltersFor).toHaveBeenCalledWith('list-1')
    expect(setShowSettingsPopover).not.toHaveBeenCalled()
  })

  it('puts the funnel before the gear, so the gear stays rightmost', () => {
    render(<TaskManagerHeader {...props} setShowSortFiltersFor={vi.fn()} />)

    expect(funnel()!.compareDocumentPosition(gear()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds no second funnel to a system list, whose one button is already one', () => {
    // On my-tasks/today/etc. the single header button is itself a funnel — its
    // settings popover IS the filter panel — so a second would be a duplicate.
    render(<TaskManagerHeader {...props} selectedListId="my-tasks" setShowSortFiltersFor={vi.fn()} />)

    expect(document.querySelectorAll('[data-sort-filters-button]')).toHaveLength(0)
    expect(gear()).not.toBeNull()
  })
})
