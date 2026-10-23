import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ListSortAndFilters } from '@/components/list-sort-and-filters'
import { SettingsModalShell } from '@/components/list-settings/SettingsModalShell'
import type { TaskList, User } from '@/types/task'

/**
 * ListSortAndFilters — the Sort & Filters panel.
 *
 * AWTD-1343 merged list-sort-and-filters-layout.test.tsx and
 * list-sort-filters-show-subtasks.test.tsx, which rendered the same component
 * with copies of the same fixtures. (The popover that hosts this panel is
 * list-sort-and-filters-popover.test.tsx — it mocks the panel out.)
 *
 * AWTD-1271 — Sort & Filters puts what people use most at the top.
 *
 * Jon, 2026-10-19: sort first, then complete/incomplete, then the other
 * filters; favourite / saved filter / show subtasks at the bottom. Every
 * selector the same kind of control (Assignee and Assigned-by were text links
 * that turned into dropdowns on tap), every dropdown the same width so they
 * line up, and a panel lighter than a full-screen modal.
 */

const currentUser = {
  id: 'u-1',
  email: 'u@example.com',
  name: 'U',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as User

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test',
    privacy: 'PRIVATE',
    owner: currentUser,
    ownerId: 'u-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as TaskList
}

function renderPanel(list: TaskList = makeList(), onUpdate = vi.fn(), canEditSettings = true) {
  const utils = render(
    <ListSortAndFilters
      list={list}
      currentUser={currentUser}
      onUpdate={onUpdate}
      canEditSettings={canEditSettings}
    />,
  )
  return { ...utils, onUpdate }
}

const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('AWTD-1271 — Sort & Filters layout', () => {
  it('leads with Sort, then Show tasks, and puts list options last', () => {
    const { getByTestId } = renderPanel()
    const order = [
      'sort-by-row',
      'show-tasks-row',
      'priority-filter-row',
      'list-options-section',
    ].map(id => getByTestId(id))

    for (let i = 0; i < order.length - 1; i++) {
      expect(isBefore(order[i], order[i + 1])).toBe(true)
    }

    const options = getByTestId('list-options-section')
    expect(options.contains(getByTestId('favorite-row'))).toBe(true)
    expect(options.contains(getByTestId('saved-filter-row'))).toBe(true)
    expect(options.contains(getByTestId('show-subtasks-row'))).toBe(true)
  })

  it('renders every sort and filter as a dropdown on first paint — no tap-to-edit links', () => {
    const { getAllByRole } = renderPanel()
    // sort, show, priority, assignee, due date, assigned by, repeating, lists
    expect(getAllByRole('combobox')).toHaveLength(8)
  })

  it('gives every dropdown the same width so they line up', () => {
    const { getAllByRole } = renderPanel()
    const widths = getAllByRole('combobox').map(el =>
      el.className.split(/\s+/).filter(c => /^(min-)?w-/.test(c)).sort().join(' '),
    )
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).not.toBe('')
  })
})

/**
 * Task dce843a1 — the per-list "Show subtasks" toggle lives in the
 * Sort & Filters tab of list settings.
 *
 * It sits there rather than in Admin Settings because it decides what the
 * list VIEW renders, which is what everything else on that tab does. It is
 * still gated on canEditSettings: the API accepts showSubtasks only from an
 * owner/admin, so offering it to a plain member would be a control whose
 * save comes back 403.
 */

describe('ListSortAndFilters — Show subtasks toggle', () => {
  // Present for an editor: asserted by the layout test above (row inside
  // list options) and by every toggle lookup below.
  it('is ON for a list that predates the column', () => {
    // Absent must read as SHOW, or every existing list looks deliberately
    // switched off the moment this ships.
    const { getByTestId } = renderPanel(makeList({ showSubtasks: undefined }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('checked')
  })

  it('is OFF for a list that opted out', () => {
    const { getByTestId } = renderPanel(makeList({ showSubtasks: false }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('unchecked')
  })

  it('sends a real boolean up, which is what the API requires to write it', () => {
    const { getByTestId, onUpdate } = renderPanel(makeList({ showSubtasks: true }))
    fireEvent.click(getByTestId('show-subtasks-toggle'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0].showSubtasks).toBe(false)
  })

  it('is hidden from a member who cannot edit list settings', () => {
    const { queryByTestId } = renderPanel(makeList(), vi.fn(), false)
    expect(queryByTestId('show-subtasks-row')).toBeNull()
  })
})

describe('AWTD-1271 — SettingsModalShell sheet variant', () => {
  it('is a content-sized sheet rather than a full-screen takeover', () => {
    render(
      <SettingsModalShell open onOpenChange={vi.fn()} header={<span>h</span>} variant="sheet">
        <div />
      </SettingsModalShell>,
    )
    const card = document.querySelector('[data-testid="settings-modal-card"]')!
    expect(card).toBeTruthy()
    expect(card.className.split(/\s+/)).not.toContain('h-full')
  })

  it('keeps the full-screen card by default, so List Settings is unchanged', () => {
    render(
      <SettingsModalShell open onOpenChange={vi.fn()} header={<span>h</span>}>
        <div />
      </SettingsModalShell>,
    )
    const card = document.querySelector('[data-testid="settings-modal-card"]')!
    expect(card.className.split(/\s+/)).toContain('h-full')
  })
})
