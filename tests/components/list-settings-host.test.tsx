/**
 * Reuse Phase 3 (task ecf56cd3): MainContent carried four near-identical
 * list-settings popover mounts — desktop/mobile × custom-list/system-list. The
 * desktop and mobile blocks were identical apart from their React key, so ~20
 * props were repeated four times and every change had to be made in all four.
 *
 * ListSettingsHost owns the one real decision (system list -> fixed popover,
 * user list -> full popover). These pin that routing and the guards, so the
 * consolidation cannot silently change which popover a list gets.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ListSettingsHost, isSystemList, SYSTEM_LIST_IDS } from '@/components/TaskManager/MainContent/ListSettingsHost'

vi.mock('@/components/list-settings-popover', () => ({
  ListSettingsPopover: ({ canEditSettings }: { canEditSettings: boolean }) => (
    <div data-testid="list-settings-popover" data-can-edit={String(canEditSettings)} />
  ),
}))
vi.mock('@/components/fixed-list-settings-popover', () => ({
  FixedListSettingsPopover: ({ listName }: { listName: string }) => (
    <div data-testid="fixed-list-settings-popover" data-list-name={listName} />
  ),
}))

const filterState = {
  filters: { priority: null, assignee: null, dueDate: null, completed: null, sortBy: null },
  setPriority: vi.fn(), setAssignee: vi.fn(), setDueDate: vi.fn(),
  setCompleted: vi.fn(), setSortBy: vi.fn(),
  hasActiveFilters: false, clearAllFilters: vi.fn(),
}

function renderHost(overrides: Record<string, unknown> = {}) {
  const props = {
    variant: 'desktop' as const,
    selectedListId: 'list-1',
    lists: [{ id: 'list-1' }],
    listMetadata: null,
    currentUser: { id: 'u1' },
    availableUsers: [],
    showSettingsPopover: 'list-1',
    setShowSettingsPopover: vi.fn(),
    canEditListSettings: () => true,
    isViewingFromFeatured: false,
    selectedListInfo: { name: 'My Tasks' },
    filterState,
    statuses: [],
    onEditImage: vi.fn(),
    onLeave: vi.fn(),
    onListUpdate: vi.fn(),
    onFavoriteToggle: vi.fn(),
    onProjectBoardCreated: vi.fn(),
    onProjectBoardRemoved: vi.fn(),
    onStatusesChanged: vi.fn(),
    onListDelete: vi.fn(),
    ...overrides,
  }
  return render(<ListSettingsHost {...(props as never)} />)
}

describe('ListSettingsHost (task ecf56cd3)', () => {
  it('gives system lists the fixed popover', () => {
    renderHost({ selectedListId: 'my-tasks', showSettingsPopover: 'my-tasks' })

    expect(screen.getByTestId('fixed-list-settings-popover')).toBeTruthy()
    expect(screen.queryByTestId('list-settings-popover')).toBeNull()
  })

  it('gives user lists the full popover', () => {
    renderHost()

    expect(screen.getByTestId('list-settings-popover')).toBeTruthy()
    expect(screen.queryByTestId('fixed-list-settings-popover')).toBeNull()
  })

  it('treats every documented system list id as a system list', () => {
    for (const id of SYSTEM_LIST_IDS) {
      expect(isSystemList(id), `${id} should be a system list`).toBe(true)
    }
    expect(isSystemList('some-user-list')).toBe(false)
  })

  it('renders nothing for a user list when the popover is closed', () => {
    const { container } = renderHost({ showSettingsPopover: null })
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the selected list is not found', () => {
    const { container } = renderHost({ selectedListId: 'missing', showSettingsPopover: 'missing', lists: [] })
    expect(container.innerHTML).toBe('')
  })

  it('falls back to listMetadata when the list is not in the loaded list array', () => {
    // Deep-linking into a list that has not loaded yet still needs settings.
    renderHost({ lists: [], listMetadata: { id: 'list-1' } })
    expect(screen.getByTestId('list-settings-popover')).toBeTruthy()
  })

  it('withholds edit rights when viewing from Featured', () => {
    renderHost({ isViewingFromFeatured: true })
    expect(screen.getByTestId('list-settings-popover').getAttribute('data-can-edit')).toBe('false')
  })
})
