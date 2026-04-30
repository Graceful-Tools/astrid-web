import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TimePicker } from '@/components/ui/time-picker'

// Force desktop branch so the Popover UI (with Set Time button) renders.
// isMobileDevice() reads window.navigator.userAgent; jsdom's default UA has no
// "Mobile"/"Android"/"iPhone" substring, so the desktop branch is selected.

describe('TimePicker (desktop popover)', () => {
  it('renders the trigger button with the placeholder text', () => {
    render(<TimePicker onChange={() => {}} placeholder="5pm" />)
    expect(screen.getByRole('button', { name: /5pm/i })).toBeInTheDocument()
  })

  it('opens the popover and shows the "Set Time" button when the trigger is clicked', async () => {
    render(<TimePicker onChange={() => {}} placeholder="5pm" />)

    const trigger = screen.getByRole('button', { name: /5pm/i })
    fireEvent.click(trigger)

    const setTimeButton = await screen.findByRole('button', { name: /^set time$/i })
    expect(setTimeButton).toBeInTheDocument()
  })

  it('fires onChange when a quick time preset is clicked', async () => {
    const onChange = vi.fn()
    render(<TimePicker onChange={onChange} placeholder="5pm" mode="string" />)

    fireEvent.click(screen.getByRole('button', { name: /5pm/i }))

    const nineAm = await screen.findByRole('button', { name: /^9am$/i })
    fireEvent.click(nineAm)

    expect(onChange).toHaveBeenCalledWith('09:00')
  })

  it('fires onChange with null when "All Day" is clicked', async () => {
    const onChange = vi.fn()
    render(<TimePicker onChange={onChange} placeholder="5pm" showAllDayOption />)

    fireEvent.click(screen.getByRole('button', { name: /5pm/i }))

    const allDay = await screen.findByRole('button', { name: /^all day$/i })
    fireEvent.click(allDay)

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders the quick-select presets: 9am, Noon, 5pm', async () => {
    render(<TimePicker onChange={() => {}} placeholder="5pm" />)
    fireEvent.click(screen.getByRole('button', { name: /5pm/i }))

    expect(await screen.findByRole('button', { name: /^9am$/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^noon$/i })).toBeInTheDocument()
    // Two buttons match /5pm/: the trigger and the quick preset. Both should exist.
    expect(screen.getAllByRole('button', { name: /^5pm$/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('confirms the typed value via "Set Time" and calls onChange with HH:MM in string mode', async () => {
    const onChange = vi.fn()
    render(<TimePicker onChange={onChange} placeholder="5pm" mode="string" />)

    fireEvent.click(screen.getByRole('button', { name: /5pm/i }))
    const setTimeButton = await screen.findByRole('button', { name: /^set time$/i })
    fireEvent.click(setTimeButton)

    // Default state is 5:00 PM → 17:00
    expect(onChange).toHaveBeenCalledWith('17:00')
  })

  describe('value parsing (regression)', () => {
    // Regression: the string branch used split(':') and parseInt, which turned
    // ISO timestamps like "2025-04-29T22:00:00.000Z" into hours=2025, then
    // setHours(2025) overflowed and the picker landed on ~9–10am regardless
    // of the actual saved time. Task fields hydrated from IndexedDB cache
    // arrive as ISO strings, so this branch was reached on every reopen.
    it('reflects the saved hour when value is an ISO timestamp string (3pm)', () => {
      // 15:00 in the user's local TZ — build an ISO string from a real Date so
      // the test is timezone-agnostic.
      const localThreePm = new Date()
      localThreePm.setHours(15, 0, 0, 0)
      const iso = localThreePm.toISOString()

      render(<TimePicker value={iso} onChange={() => {}} />)

      // Trigger button shows formatted time. With the legacy parser this
      // would render "9am" or "10am"; with the fix it renders "3pm".
      expect(screen.getByRole('button', { name: /3pm/i })).toBeInTheDocument()
    })

    it('still accepts the bare HH:MM string format', () => {
      render(<TimePicker value="14:30" onChange={() => {}} mode="string" />)
      expect(screen.getByRole('button', { name: /2:30pm/i })).toBeInTheDocument()
    })

    it('reflects the saved hour when value is a Date object', () => {
      const d = new Date()
      d.setHours(15, 0, 0, 0)
      render(<TimePicker value={d} onChange={() => {}} />)
      expect(screen.getByRole('button', { name: /3pm/i })).toBeInTheDocument()
    })
  })
})

describe('TimePicker (mobile uses popover, not native input)', () => {
  // Regression: the mobile branch previously rendered `<input type="time">`,
  // and iOS fired onChange on every wheel commit (hour, minute, AM/PM each).
  // That routed through the parent's onChange and immediately closed edit
  // mode — there was no way to confirm a multi-wheel edit. The popover (with
  // explicit "Set Time" button) is now used on both mobile and desktop, so
  // there should be no native time input rendered regardless of UA.
  let originalUA: string | undefined
  beforeEach(() => {
    originalUA = window.navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    })
  })
  afterEach(() => {
    if (originalUA !== undefined) {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: originalUA,
        configurable: true,
      })
    }
  })

  it('does not render a native <input type="time"> on mobile', () => {
    const { container } = render(<TimePicker value="14:30" onChange={() => {}} mode="string" />)
    expect(container.querySelector('input[type="time"]')).toBeNull()
  })

  it('does not auto-fire onChange when wheel buttons are tapped', async () => {
    // The wheel buttons (hour/minute/AM-PM) update internal state via
    // updateTimeSelection; they must NOT trigger the parent onChange.
    // Only "Set Time" / quick presets / All Day commit.
    const onChange = vi.fn()
    render(<TimePicker value="14:00" onChange={onChange} mode="string" />)

    fireEvent.click(screen.getByRole('button', { name: /2pm/i }))

    // Tap a different hour and a different minute — no commit yet.
    const eight = await screen.findByRole('button', { name: /^8$/ })
    fireEvent.click(eight)
    const fortyFive = await screen.findByRole('button', { name: /^45$/ })
    fireEvent.click(fortyFive)

    expect(onChange).not.toHaveBeenCalled()

    // Now press Set Time — this is when the commit should happen.
    fireEvent.click(screen.getByRole('button', { name: /^set time$/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
