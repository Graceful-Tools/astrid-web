import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  TaskDetailReminderRow,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
} from '@/components/task-detail/TaskDetailReminderRow'

// AWTD-1418: web had no control that set a task's reminderTime.
describe('TaskDetailReminderRow (AWTD-1418)', () => {
  it('round-trips a local date-time', () => {
    const date = new Date(2026, 9, 31, 14, 5)
    expect(toDateTimeLocalValue(date)).toBe('2026-10-31T14:05')
    expect(fromDateTimeLocalValue('2026-10-31T14:05')?.getTime()).toBe(date.getTime())
    expect(fromDateTimeLocalValue('')).toBeNull()
    expect(toDateTimeLocalValue(null)).toBe('')
  })

  it('reports the chosen time', () => {
    const onChange = vi.fn()
    render(<TaskDetailReminderRow value={null} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('reminder-time').querySelector('input')!, {
      target: { value: '2026-10-31T14:05' },
    })
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 9, 31, 14, 5))
  })

  it('clears the reminder with null', () => {
    const onChange = vi.fn()
    render(<TaskDetailReminderRow value={new Date(2026, 9, 31, 14, 5)} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('is read-only for a viewer', () => {
    render(<TaskDetailReminderRow value={new Date(2026, 9, 31, 14, 5)} onChange={vi.fn()} readOnly />)
    expect(screen.getByTestId('reminder-time').querySelector('input')).toBeDisabled()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
