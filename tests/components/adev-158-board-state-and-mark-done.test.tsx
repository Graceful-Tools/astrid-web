/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-158: one board-state picker and one "Mark as done" row, matching iOS's
 * `ProjectStateQuickPicker` and `MarkDoneQuickSetRow`.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardStatePicker } from '@/components/board-state-picker'
import { MarkDoneQuickSetRow } from '@/components/mark-done-quick-set-row'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))

const columns = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
]

describe('BoardStatePicker (ADEV-158)', () => {
  it('washes the selected chip in the accent and leaves the others outlined', () => {
    render(<BoardStatePicker columns={columns} selectedColumnId="b" onSelect={vi.fn()} ariaLabel="State" />)

    const selected = screen.getByText('Beta')
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected.className).toContain('bg-brand/20')
    expect(selected.className).toContain('text-xs')
    expect(selected.className).not.toContain('bg-brand text-brand-foreground')

    const other = screen.getByText('Alpha')
    expect(other).toHaveAttribute('aria-pressed', 'false')
    expect(other.className).toContain('border-theme-button')
  })

  it('selects the tapped column', () => {
    const onSelect = vi.fn()
    render(<BoardStatePicker columns={columns} selectedColumnId="b" onSelect={onSelect} ariaLabel="State" />)

    fireEvent.click(screen.getByText('Alpha'))

    expect(onSelect).toHaveBeenCalledWith('a')
  })
})

describe('MarkDoneQuickSetRow (ADEV-158)', () => {
  const base = { priority: 0, completed: false, onToggleComplete: vi.fn(), onCancel: vi.fn() }

  it("your own task: one row on the secondary surface with the checkbox", () => {
    render(<MarkDoneQuickSetRow {...base} asksBeforeCompleting={false} />)

    const row = screen.getByTestId('task-options-complete')
    expect(row.className).toContain('bg-secondary')
    expect(row).toHaveTextContent('tasks.markAsDone')
    expect(screen.getByTestId('task-options-complete-icon')).toBeTruthy()
  })

  it("someone else's task: one muted line and no title", () => {
    render(
      <MarkDoneQuickSetRow {...base} asksBeforeCompleting holderLine="Assigned to Sam" />,
    )

    const line = screen.getByTestId('task-options-complete-holder')
    expect(line).toHaveTextContent('Assigned to Sam')
    expect(line.className).toContain('text-theme-muted')
    expect(screen.queryByText('tasks.confirmCompleteTitle')).toBeNull()
    expect(screen.queryByTestId('task-options-complete-icon')).toBeNull()
  })
})
