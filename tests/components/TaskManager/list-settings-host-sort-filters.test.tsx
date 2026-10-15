/**
 * @vitest-environment jsdom
 *
 * AWTD-1175 — the layout decides where Sort & Filters is reached, and this is
 * the join where the old bug actually lived: MainContent gated the funnel on
 * `is3Column` and ListSettingsHost knew nothing about the layout at all, so
 * below 3 columns a user list offered NEITHER entry point.
 *
 * Testing the host rather than only the rule is the point: the rule has been
 * right in both places on its own before.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/list-membership', () => ({
  ListMembership: () => <div data-testid="membership-body" />,
}))
vi.mock('@/components/list-admin-settings', () => ({
  ListAdminSettings: () => <div data-testid="admin-body" />,
}))
vi.mock('@/components/list-admin/ManageStatusesPanel', () => ({
  ManageStatusesPanel: () => <div data-testid="statuses-body" />,
}))
vi.mock('@/components/list-sort-and-filters', () => ({
  ListSortAndFilters: () => <div data-testid="sort-filters-panel" />,
}))

import { ListSettingsHost, type ListSettingsHostProps } from '@/components/TaskManager/MainContent/ListSettingsHost'
import type { ColumnCount } from '@/lib/layout-detection'

const LIST_ID = 'list-1'

function renderHost(columnCount: ColumnCount, overrides: Partial<ListSettingsHostProps> = {}) {
  const setShowSettingsPopover = vi.fn()
  const setShowSortFiltersPopover = vi.fn()
  render(
    <ListSettingsHost
      variant="mobile"
      columnCount={columnCount}
      selectedListId={LIST_ID}
      lists={[{ id: LIST_ID }]}
      currentUser={{ id: 'user-1' }}
      availableUsers={[]}
      showSettingsPopover={LIST_ID}
      setShowSettingsPopover={setShowSettingsPopover}
      showSortFiltersPopover={null}
      setShowSortFiltersPopover={setShowSortFiltersPopover}
      canEditListSettings={() => true}
      selectedListInfo={{ name: 'Engineering' }}
      filterState={{} as never}
      statuses={[]}
      onEditImage={vi.fn()}
      onLeave={vi.fn()}
      onListUpdate={vi.fn()}
      onFavoriteToggle={vi.fn()}
      onProjectBoardCreated={vi.fn()}
      onProjectBoardRemoved={vi.fn()}
      onStatusesChanged={vi.fn()}
      onListDelete={vi.fn()}
      {...overrides}
    />
  )
  return { setShowSettingsPopover, setShowSortFiltersPopover }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ListSettingsHost — reaching Sort & Filters', () => {
  it.each([1, 2] as ColumnCount[])(
    'offers it inside List Settings on %i column(s)',
    columnCount => {
      renderHost(columnCount)

      expect(screen.getByTestId('sort-filters-entry')).toBeTruthy()
    },
  )

  it('leaves List Settings alone in 3 columns, where the funnel is in the header', () => {
    renderHost(3)

    expect(screen.queryByTestId('sort-filters-entry')).toBeNull()
  })

  it('swaps one panel for the other when the entry is used', () => {
    // Closing List Settings matters: two stacked modals on a phone leaves the
    // viewer tapping an overlay to get back to a list they never left.
    const { setShowSettingsPopover, setShowSortFiltersPopover } = renderHost(1)

    fireEvent.click(screen.getByTestId('sort-filters-entry'))

    expect(setShowSettingsPopover).toHaveBeenCalledWith(null)
    expect(setShowSortFiltersPopover).toHaveBeenCalledWith(LIST_ID)
  })

  it('still opens the per-user panel when that is what is open', () => {
    // The two flags are independent, so the narrow layout must be able to show
    // the Sort & Filters panel on its own — that is where the entry leads.
    renderHost(1, { showSettingsPopover: null, showSortFiltersPopover: LIST_ID })

    expect(screen.getByTestId('sort-filters-panel')).toBeTruthy()
    expect(screen.queryByTestId('sort-filters-entry')).toBeNull()
  })

  it('does not reach for a system list, which has its own filter panel', () => {
    // My Tasks and friends get FixedListSettingsPopover, a filter panel from
    // the start, so the entry would be a route to a thing they already are.
    renderHost(1, { selectedListId: 'my-tasks', showSettingsPopover: 'my-tasks', filterState: {
      filters: { priority: [], assignee: [], dueDate: 'all', completed: 'all', sortBy: 'auto' },
      setPriority: vi.fn(), setAssignee: vi.fn(), setDueDate: vi.fn(), setCompleted: vi.fn(),
      setSortBy: vi.fn(), hasActiveFilters: false, clearAllFilters: vi.fn(),
    } as never })

    expect(screen.queryByTestId('sort-filters-entry')).toBeNull()
  })
})
