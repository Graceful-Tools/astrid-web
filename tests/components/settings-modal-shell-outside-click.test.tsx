/**
 * AWTD-1595 — Clicking the Insights tab closed the List Settings dialog.
 *
 * Not navigation: a click that STARTED inside the card was read as a click
 * outside it. Radix tabs switch on mousedown, so pressing Insights swapped the
 * tall Membership body for Insights' one-line "Loading…" before the button came
 * up. The card is centred and auto-height on desktop, so it shrank under the
 * pointer, the mouseup landed on the overlay, and the browser fires `click` on
 * the nearest common ancestor of the two — the overlay, whose onClick closed
 * the modal.
 *
 * Only a press that both begins and ends on the overlay itself dismisses now.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettingsModalShell } from '@/components/list-settings/SettingsModalShell'

function renderShell() {
  const onOpenChange = vi.fn()
  render(
    <SettingsModalShell open onOpenChange={onOpenChange} header={<h2>List Settings</h2>}>
      <button type="button">Insights</button>
    </SettingsModalShell>
  )
  const overlay = screen.getByRole('dialog')
  return { onOpenChange, overlay }
}

describe('SettingsModalShell outside click (AWTD-1595)', () => {
  it('stays open when a press starts on a tab and is released on the overlay', () => {
    const { onOpenChange, overlay } = renderShell()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Insights' }))
    // The card shrank under the pointer: the browser dispatches the click on
    // the common ancestor, which is the overlay.
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('stays open when a press starts on the overlay and is released inside the card', () => {
    const { onOpenChange, overlay } = renderShell()

    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(screen.getByRole('button', { name: 'Insights' }))
    // Common ancestor again: the click lands on the overlay.
    fireEvent.click(overlay)

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('still closes on a real click outside the card', () => {
    const { onOpenChange, overlay } = renderShell()

    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
