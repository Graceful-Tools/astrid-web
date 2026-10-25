/**
 * AWTD-1379 — the drawer's transparent tap guard must not appear mid-animation.
 *
 * Opening the left panel slides `.ios-drawer-content` right by `min(85vw, 320px)`
 * over 0.3s. The guard (`.ios-drawer-overlay`) is positioned at that FINAL left
 * edge and is not itself animated, so while the content was still travelling the
 * guard already sat at its destination: a grey rectangle hanging in the air over
 * content that had not moved yet. Jon's screenshot catches it ~80% through the
 * slide — the tint starts well to the right of the panel's edge — and he reported
 * it on mobile and desktop web, which matches `isIOSDrawer = showHamburgerMenu ||
 * (isMobile && isBoardMode)` being true in both.
 *
 * Two things were wrong, and the fix needs both:
 *
 * 1. React mounted the guard only once the drawer was already opening, and mounted
 *    it with the final class already applied. A freshly inserted element has no
 *    previous computed style, so its `opacity` transition never ran — it painted
 *    at full strength on the first frame. The element has to exist, as the SAME
 *    DOM node, before the drawer opens.
 * 2. The CSS had no delay, so even with a working transition the guard would fade
 *    in while the panel was still sliding. Jon: "It should only appear after the
 *    panel is completely open."
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DrawerTapGuard } from '@/components/TaskManager/DrawerTapGuard'

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')

function ruleBody(selector: string): string {
  const start = css.indexOf(selector + ' {')
  if (start === -1) throw new Error(`selector ${selector} not found`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const guard = () => document.querySelector('.ios-drawer-overlay')

describe('iOS drawer tap guard (AWTD-1379)', () => {
  it('is already mounted while the drawer is closed, so opening it can transition', () => {
    render(<DrawerTapGuard open={false} onDismiss={vi.fn()} />)

    // Present but inert — the base rule carries opacity 0 and pointer-events none.
    expect(guard()).toBeInTheDocument()
    expect(guard()).not.toHaveClass('ios-drawer-overlay-visible')
  })

  it('reuses that same node when the drawer opens, rather than mounting a fresh one', () => {
    const { rerender } = render(<DrawerTapGuard open={false} onDismiss={vi.fn()} />)
    const before = guard()

    rerender(<DrawerTapGuard open={true} onDismiss={vi.fn()} />)

    // Node identity is the whole point: a remount paints the final style on the
    // first frame with nothing to transition from, which is the original bug.
    expect(guard()).toBe(before)
    expect(guard()).toHaveClass('ios-drawer-overlay-visible')
  })

  it('still closes the drawer when it is tapped', () => {
    const onDismiss = vi.fn()
    render(<DrawerTapGuard open={true} onDismiss={onDismiss} />)

    fireEvent.click(guard()!)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores taps while the drawer is closed', () => {
    const onDismiss = vi.fn()
    render(<DrawerTapGuard open={false} onDismiss={onDismiss} />)

    // pointer-events: none keeps a real browser off it; jsdom has no layout, so
    // the handler must not be attached either.
    fireEvent.click(guard()!)

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('waits for the panel before tinting anything — the delay equals the slide', () => {
    // The guard sits at the drawer's final left edge, so any opacity it carries
    // before the slide ends is drawn in the wrong place.
    const visible = ruleBody('.ios-drawer-overlay-visible')
    expect(visible).toMatch(/opacity:\s*0\.3/)
    expect(visible).toMatch(/var\(--ios-drawer-duration\)/)

    // One source for both halves, so the guard cannot drift out of step with the
    // panel it is waiting for.
    expect(ruleBody('.ios-drawer-content')).toMatch(/var\(--ios-drawer-duration\)/)
  })

  it('closes at once rather than waiting out the delay a second time', () => {
    // Only the -visible rule carries the delay. Dropping that class reverts to
    // the base rule, whose transition has none, so the tint leaves with the panel.
    const base = ruleBody('.ios-drawer-overlay')
    expect(base).toMatch(/opacity:\s*0/)
    expect(base).not.toMatch(/transition-delay/)
  })
})
