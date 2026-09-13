/**
 * Task aa4e7eb0 — Sort & Filters as its own control, outside List Settings.
 *
 * Jon: "separate out the sort from Admin/membership."
 *
 * The panel itself did not change; where it lives did. So what is worth
 * asserting here is the separation and the claim the new chrome makes: that
 * these settings are the viewer's own. That sentence is the whole reason the
 * move was worth making, and it is the thing that would quietly rot if the
 * storage ever went back to being shared.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { buildTaskList, buildUser } from '../fixtures/domain'
import { ListSortAndFiltersPopover } from '@/components/list-sort-and-filters-popover'
import type { TaskList, User } from '@/types/task'

vi.mock('@/components/list-sort-and-filters', () => ({
  ListSortAndFilters: ({ canEditSettings }: { canEditSettings?: boolean }) => (
    <div data-testid="sort-filters-content" data-can-edit={String(canEditSettings)}>
      Sort &amp; Filters Content
    </div>
  ),
}))

const list: TaskList = buildTaskList({
  id: 'list-1',
  name: 'Work',
  ownerId: 'owner-1',
  privacy: 'PRIVATE',
  isVirtual: false,
})

const user: User = buildUser({ id: 'owner-1', name: 'Jon', email: 'jon@example.com' })

function renderPopover(props: Partial<{ open: boolean; canEditSettings: boolean }> = {}) {
  const onOpenChange = vi.fn()
  render(
    <ListSortAndFiltersPopover
      list={list}
      currentUser={user}
      open={props.open ?? true}
      onOpenChange={onOpenChange}
      onUpdate={vi.fn()}
      canEditSettings={props.canEditSettings ?? false}
    />
  )
  return { onOpenChange }
}

describe('ListSortAndFiltersPopover (task aa4e7eb0)', () => {
  it('renders the sort & filters panel on its own', () => {
    renderPopover()

    expect(screen.getByTestId('sort-filters-content')).toBeInTheDocument()
  })

  it('offers no tabs — it is one panel, not a section of List Settings', () => {
    // The separation, stated as an assertion: if this ever grows a tablist it
    // has drifted back toward being a settings modal.
    renderPopover()

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('shows none of what belongs to the list itself', () => {
    renderPopover({ canEditSettings: true })

    expect(screen.queryByText(/membership/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/admin settings/i)).not.toBeInTheDocument()
  })

  it('says whose settings these are', () => {
    // The point of the move. Without this line the control is just a panel in
    // a different place, and a person still has to guess who it affects.
    renderPopover()

    expect(screen.getByText(/only you see these/i)).toBeInTheDocument()
  })

  it('passes canEditSettings through, which gates the list-level subtask toggle', () => {
    renderPopover({ canEditSettings: true })

    expect(screen.getByTestId('sort-filters-content')).toHaveAttribute('data-can-edit', 'true')
  })

  it('renders nothing when closed', () => {
    renderPopover({ open: false })

    expect(screen.queryByTestId('sort-filters-content')).not.toBeInTheDocument()
  })

  it('closes on Escape and on a click outside, like the popovers it shares chrome with', () => {
    // Both handlers live on SettingsModalShell's overlay, so the events are
    // dispatched there. Worth knowing that Escape is an onKeyDown on that
    // element rather than a document listener, so it only fires once focus is
    // inside the modal — pre-existing behaviour of all three popovers, not
    // something this control changed.
    const { onOpenChange } = renderPopover()
    const overlay = screen.getByRole('dialog')

    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    onOpenChange.mockClear()
    fireEvent.click(overlay)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
