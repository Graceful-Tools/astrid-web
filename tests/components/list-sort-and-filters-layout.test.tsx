import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ListSortAndFilters } from '@/components/list-sort-and-filters'
import { SettingsModalShell } from '@/components/list-settings/SettingsModalShell'
import type { TaskList, User } from '@/types/task'

/**
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

function renderPanel() {
  return render(
    <ListSortAndFilters list={makeList()} currentUser={currentUser} onUpdate={vi.fn()} canEditSettings />,
  )
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
