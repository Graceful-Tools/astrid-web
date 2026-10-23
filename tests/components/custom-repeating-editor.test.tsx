import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  CustomRepeatingEditor,
  isCustomPatternSavable,
} from '@/components/custom-repeating-editor'
import type { CustomRepeatingPattern } from '@/types/repeating'

// AWTD-1352: "Setting custom repeat isn't great — cannot update day of week
// to 0 to add a day." The editor refused to uncheck the last weekday, so
// swapping Monday for Sunday meant first checking a day you did not want; and
// the number fields snapped an emptied value straight back to 1, so retyping
// "Repeat every" turned 4 into 14.

const weekly = (weekdays: string[], interval = 4): CustomRepeatingPattern =>
  ({ type: 'custom', unit: 'weeks', interval, weekdays, endCondition: 'never' }) as CustomRepeatingPattern

function renderEditor(value: CustomRepeatingPattern) {
  const onChange = vi.fn()
  render(<CustomRepeatingEditor value={value} onChange={onChange} onCancel={() => {}} />)
  const last = () => onChange.mock.calls.at(-1)?.[0] as CustomRepeatingPattern
  return { onChange, last }
}

describe('CustomRepeatingEditor (AWTD-1352)', () => {
  it('AWTD-1352: the only checked weekday can be unchecked, then another day picked', () => {
    const { last } = renderEditor(weekly(['monday']))

    const monday = screen.getByRole('checkbox', { name: 'Monday' })
    fireEvent.click(monday)
    expect(monday).toHaveAttribute('data-state', 'unchecked')
    expect(last()).toMatchObject({ unit: 'weeks', weekdays: [] })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sunday' }))
    expect(last()).toMatchObject({ unit: 'weeks', weekdays: ['sunday'] })
  })

  it('AWTD-1352: "Repeat every" can be cleared and retyped without snapping to 1', () => {
    const { last } = renderEditor(weekly(['monday'], 4))

    const interval = screen.getByLabelText('Repeat every') as HTMLInputElement
    fireEvent.change(interval, { target: { value: '' } })
    expect(interval.value).toBe('')

    fireEvent.change(interval, { target: { value: '3' } })
    expect(interval.value).toBe('3')
    expect(last()).toMatchObject({ interval: 3 })
  })

  it('AWTD-1352: an emptied "Repeat every" goes back to its last good value when the field is left', () => {
    const { last } = renderEditor(weekly(['monday'], 4))

    const interval = screen.getByLabelText('Repeat every') as HTMLInputElement
    fireEvent.change(interval, { target: { value: '' } })
    fireEvent.blur(interval)

    expect(interval.value).toBe('4')
    expect(last()).toMatchObject({ interval: 4 })
  })

  it('AWTD-1352: "0" is not taken as an interval', () => {
    const { last } = renderEditor(weekly(['monday'], 4))

    const interval = screen.getByLabelText('Repeat every') as HTMLInputElement
    fireEvent.change(interval, { target: { value: '0' } })
    expect(last()).toMatchObject({ interval: 4 })
    fireEvent.blur(interval)
    expect(interval.value).toBe('4')
  })

  it('AWTD-1352: a weekly pattern with no days says to pick one', () => {
    renderEditor(weekly(['monday']))
    expect(screen.queryByText('Pick at least one day')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    expect(screen.getByText('Pick at least one day')).toBeInTheDocument()
  })
})

describe('isCustomPatternSavable (AWTD-1352)', () => {
  it('refuses a weekly pattern with no days, so an empty set is never saved', () => {
    expect(isCustomPatternSavable(weekly([]))).toBe(false)
    expect(isCustomPatternSavable(weekly(['sunday']))).toBe(true)
  })

  it('accepts patterns of other units, and nothing at all is not savable', () => {
    expect(
      isCustomPatternSavable({ type: 'custom', unit: 'days', interval: 2, endCondition: 'never' } as CustomRepeatingPattern),
    ).toBe(true)
    expect(isCustomPatternSavable(undefined)).toBe(false)
  })
})
