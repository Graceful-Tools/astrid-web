/**
 * The date picker still draws a month and still reports a chosen day.
 *
 * Added with the react-day-picker 9 → 10 bump (AWTD-1391). That major renamed
 * two things this repo used — `initialFocus` became `autoFocus`, and the
 * `table` classNames key became `month_grid` — and TypeScript caught both,
 * because `classNames` is typed as `Partial<ClassNames>`, so a key the library
 * no longer knows is a type error rather than a silently ignored one.
 *
 * That is good, but it only proves the props type-check. It does not prove the
 * component renders a usable calendar, and a date picker that renders nothing
 * is exactly the kind of break a suite full of reducers and API routes sails
 * straight past. Hence this: the cheapest check that the thing a user clicks
 * is actually there.
 *
 * Note the day selector. A day's accessible name is its full date —
 * "Thursday, March 12th, 2026" — not "12", so querying for the bare number
 * finds nothing. The month caption is also rendered twice, once visibly and
 * once into an `aria-live` status region, so it needs `getAllByText`.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Calendar } from '@/components/ui/calendar'

const MARCH_2026 = new Date('2026-03-15T12:00:00Z')
const day = (name: RegExp) => screen.getByRole('button', { name })

describe('Calendar (react-day-picker)', () => {
  it('draws the month it is given, with its days', () => {
    render(<Calendar mode="single" month={MARCH_2026} />)

    // Caption, so a calendar stuck on "today" or rendering an empty shell
    // fails here rather than looking fine.
    expect(screen.getAllByText(/March 2026/i).length).toBeGreaterThan(0)

    // The ends of the month, rather than a cell count, which would also catch
    // the greyed-out days either side.
    expect(day(/March 1st, 2026/)).toBeInTheDocument()
    expect(day(/March 31st, 2026/)).toBeInTheDocument()
  })

  it('reports the day that was clicked', () => {
    const onSelect = vi.fn()
    render(<Calendar mode="single" month={MARCH_2026} onSelect={onSelect} />)

    fireEvent.click(day(/March 12th, 2026/))

    expect(onSelect).toHaveBeenCalled()
    const picked = onSelect.mock.calls[0][0] as Date
    expect(picked.getDate()).toBe(12)
    expect(picked.getMonth()).toBe(2) // March
    expect(picked.getFullYear()).toBe(2026)
  })

  it('marks the selected day as selected', () => {
    render(<Calendar mode="single" month={MARCH_2026} selected={new Date('2026-03-12T12:00:00Z')} />)

    // `data-selected-single` is what the button's own Tailwind variants key
    // off, so this is the attribute that actually decides whether the day
    // looks selected — not merely that the prop was accepted.
    expect(day(/March 12th, 2026, selected/)).toHaveAttribute('data-selected-single', 'true')
  })
})
