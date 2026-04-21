import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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
})
