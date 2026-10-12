/**
 * @vitest-environment jsdom
 *
 * AWTD-1175 — a user list on a narrow layout had no way to sort or filter.
 *
 * Task aa4e7eb0 moved Sort & Filters out of the List Settings modal, which was
 * right: they are per-user, and everything else in that modal is shared. But
 * the funnel it moved to is rendered only in the 3-column header, and below
 * that the header has ONE button — the gear. So from 2026-09-13 a user list on
 * a phone or a 2-column window could not be sorted or filtered at all.
 *
 * Jon, 2026-10-12: "On mobile single column follow iOS iPhone. On 3 column
 * spit out the filter / sort web." So below 3 columns the entry point goes
 * behind the one button there is — but it still OPENS the separate per-user
 * panel rather than becoming a tab in the shared modal, which is the seam
 * aa4e7eb0 was about.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// The tabs' bodies are not what this is about, and they reach for session,
// network and a list of users. Stub them to keep the test on the entry point.
vi.mock('@/components/list-membership', () => ({
  ListMembership: () => <div data-testid="membership-body" />,
}))
vi.mock('@/components/list-admin-settings', () => ({
  ListAdminSettings: () => <div data-testid="admin-body" />,
}))
vi.mock('@/components/list-admin/ManageStatusesPanel', () => ({
  ManageStatusesPanel: () => <div data-testid="statuses-body" />,
}))

import { ListSettingsPopover } from '@/components/list-settings-popover'
import type { TaskList, User } from '@/types/task'

const list = { id: 'list-1', name: 'Engineering', privacy: 'PRIVATE' } as unknown as TaskList
const currentUser = { id: 'user-1', name: 'Jon' } as unknown as User

function renderPopover(onOpenSortAndFilters?: () => void) {
  render(
    <ListSettingsPopover
      list={list}
      currentUser={currentUser}
      availableUsers={[]}
      canEditSettings
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      open
      onOpenChange={vi.fn()}
      onOpenSortAndFilters={onOpenSortAndFilters}
    >
      <div />
    </ListSettingsPopover>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('List Settings — the Sort & Filters entry', () => {
  it('offers Sort & Filters when the layout has nowhere else to put it', () => {
    renderPopover(vi.fn())

    expect(screen.getByTestId('sort-filters-entry')).toBeTruthy()
  })

  it('opens the per-user panel rather than switching to a tab', () => {
    // The whole point: the shared modal gets an ENTRY POINT, not the controls.
    const onOpenSortAndFilters = vi.fn()
    renderPopover(onOpenSortAndFilters)

    fireEvent.click(screen.getByTestId('sort-filters-entry'))

    expect(onOpenSortAndFilters).toHaveBeenCalledTimes(1)
  })

  it('says whose settings they are, on the entry itself', () => {
    // A per-user control inside a shared-settings modal has to say so, or it
    // tells every user their filter changes the list for everyone — which is
    // the bug aa4e7eb0 fixed and this must not reintroduce.
    renderPopover(vi.fn())

    expect(screen.getByText(/only you see these/i)).toBeTruthy()
  })

  it('leaves it out where the funnel is its own control', () => {
    // 3-column passes no callback, so the modal stays exactly as it is today:
    // no second route to a control already in the header.
    renderPopover(undefined)

    expect(screen.queryByTestId('sort-filters-entry')).toBeNull()
  })

  it('does not become another tab', () => {
    renderPopover(vi.fn())

    const tabs = screen.getAllByRole('tab').map(tab => tab.textContent)
    expect(tabs.join(' ')).not.toMatch(/sort/i)
  })
})
