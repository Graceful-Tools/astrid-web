/**
 * @vitest-environment jsdom
 */

/**
 * A trade-off grid opens full screen (AWTD-1534).
 *
 * Jon: "Consider opening trafficlight in dedicated view that can be full
 * screen". Every grid carries a "Full screen" control. It opens the same grid,
 * already sanitised, in a dialog that fills the screen and scrolls both ways.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen, within, waitFor } from '@testing-library/react'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { useTradeoffGridViewer } from '@/components/shared/TradeoffGridViewer'

const grid = '| Option | Cost | Fun |\n|---|---|---|\n| Lisbon | ++ cheap | -- dull |\n| Cabin | ~ fair | + ok |'

function Host({ onHostClick = () => {} }: { onHostClick?: () => void }) {
  const viewer = useTradeoffGridViewer()
  return (
    <div onClick={onHostClick}>
      <div
        data-testid="host"
        onClick={viewer.onClick}
        onKeyDown={viewer.onKeyDown}
        dangerouslySetInnerHTML={{ __html: renderMarkdownWithLinks(`Before\n\n${grid}`, { ratingLabels: { fullScreen: 'Plein écran' } }) }}
      />
      {viewer.dialog}
    </div>
  )
}

describe('AWTD-1534 full-screen trade-off grid', () => {
  it('the renderer puts a translated full-screen control on every grid', () => {
    const html = renderMarkdownWithLinks(grid, { ratingLabels: { fullScreen: 'Plein écran' } })
    expect(html).toMatch(/<div class="tradeoff">/)
    expect(html).toMatch(/data-tradeoff-expand[^>]*>[^<]*Plein écran/)
    expect(html).toMatch(/role="button"/)
    expect(html).toMatch(/tabindex="0"/)
  })

  it('an ordinary table gets no control', () => {
    const html = renderMarkdownWithLinks('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).not.toContain('data-tradeoff-expand')
  })

  it('typed HTML cannot forge the control', () => {
    const html = renderMarkdownWithLinks('<span data-tradeoff-expand role="button">x</span>')
    expect(html).not.toContain('data-tradeoff-expand')
  })

  it('clicking the control opens the grid in a full-screen dialog, without the control', () => {
    const onHostClick = vi.fn()
    render(<Host onHostClick={onHostClick} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Plein écran/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('table')).toBeTruthy()
    expect(within(dialog).getByText('1. Lisbon')).toBeTruthy()
    expect(dialog.querySelector('[data-tradeoff-expand]')).toBeNull()
    expect(dialog.querySelector('.tradeoff-key')).not.toBeNull()
    // The description row behind it enters edit mode on click; opening the grid must not.
    expect(onHostClick).not.toHaveBeenCalled()
  })

  it('Enter on the focused control opens it too', () => {
    render(<Host />)
    fireEvent.keyDown(screen.getByRole('button', { name: /Plein écran/ }), { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Escape closes it, and a click inside it does not reach the host behind', () => {
    const onHostClick = vi.fn()
    render(<Host onHostClick={onHostClick} />)
    fireEvent.click(screen.getByRole('button', { name: /Plein écran/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('1. Lisbon'))
    expect(onHostClick).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closing hands keyboard focus back to the control that opened it', async () => {
    render(<Host />)
    const control = screen.getByRole('button', { name: /Plein écran/ })
    control.focus()
    fireEvent.keyDown(control, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(control))
  })

  it('sits above an expanded task panel (z-index 60)', () => {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: /Plein écran/ }))
    expect(screen.getByRole('dialog').className).toContain('z-[70]')
  })

  it('a click elsewhere in the text opens nothing', () => {
    const onHostClick = vi.fn()
    render(<Host onHostClick={onHostClick} />)
    fireEvent.click(screen.getByText('Before'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onHostClick).toHaveBeenCalledTimes(1)
  })
})
