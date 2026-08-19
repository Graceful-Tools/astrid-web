/**
 * @vitest-environment jsdom
 */

/**
 * Tapping inside the options sheet must not open the task (task 465e71e6).
 *
 * In project mode the leading control opens this sheet instead of completing
 * the task — so the sheet is rendered by the row, and the row's own onClick
 * opens task details. Every tap on a priority chip or an assignee therefore did
 * two things: the one asked for, and one nobody asked for.
 *
 * PORTALLING DOES NOT FIX THIS, which is the part worth writing down. The sheet
 * was moved to document.body (task: mobile board/sheet fixes) so `fixed` would
 * anchor to the viewport rather than the transformed row — and React portals
 * still propagate events through the REACT tree, not the DOM tree. The sheet is
 * physically a child of <body> and logically still a child of the row, so its
 * clicks keep arriving at the row's handler. The escape has to be explicit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

const BASE = {
  isOpen: true as const,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  selectedPriority: 0,
  selectedAssignee: null,
  availableUsers: [],
  taskId: 'task-1',
  listIds: ['list-1'],
}

/** The row that renders the sheet and opens the task on click. */
function RowHost({ onRowClick }: { onRowClick: () => void }) {
  return (
    <div data-testid="row" onClick={onRowClick}>
      <span>Task title</span>
      <PriorityAssigneePicker {...BASE} />
    </div>
  )
}

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sheet = () => document.querySelector('.fixed.inset-x-0.bottom-0.z-50') as HTMLElement
const backdrop = () => document.querySelector('.fixed.inset-0.z-40') as HTMLElement

describe('taps inside the options sheet do not reach the row', () => {
  it('does not open the task when a priority chip is tapped', () => {
    const onRowClick = vi.fn()
    render(<RowHost onRowClick={onRowClick} />)

    const chip = [...document.querySelectorAll('button')].find(
      b => (b.textContent || '').trim() === '!!!',
    )
    expect(chip, 'no priority chip rendered').toBeTruthy()
    fireEvent.click(chip!)

    expect(onRowClick, 'tapping a priority chip also opened the task').not.toHaveBeenCalled()
  })

  it('does not open the task when the sheet body is tapped', () => {
    const onRowClick = vi.fn()
    render(<RowHost onRowClick={onRowClick} />)

    fireEvent.click(sheet())

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does not open the task when the backdrop is tapped', () => {
    // The backdrop dismisses the sheet. Dismissing must not also open the task.
    const onRowClick = vi.fn()
    render(<RowHost onRowClick={onRowClick} />)

    fireEvent.click(backdrop())

    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('still lets the backdrop close the sheet', () => {
    // Guard against "fix" by swallowing every event, which would strand the
    // sheet open with no way out.
    const onClose = vi.fn()
    render(
      <div onClick={vi.fn()}>
        <PriorityAssigneePicker {...BASE} onClose={onClose} />
      </div>,
    )

    fireEvent.click(backdrop())
    // handleClose animates out before calling onClose, so assert the intent:
    // the backdrop handler ran rather than being swallowed.
    expect(backdrop().className).toContain('opacity-0')
  })

  it('still reports the chosen priority to its own handler', () => {
    // The other way to break this: stop propagation so early that the sheet's
    // own controls stop working.
    const onSelect = vi.fn()
    render(
      <div onClick={vi.fn()}>
        <PriorityAssigneePicker {...BASE} onSelect={onSelect} />
      </div>,
    )

    const chip = [...document.querySelectorAll('button')].find(
      b => (b.textContent || '').trim() === '!!',
    )
    fireEvent.click(chip!)

    expect(onSelect).toHaveBeenCalledWith(2, null)
  })
})
