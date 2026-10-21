/**
 * RULE — AWTD-1305: a scroll-snap carousel item is sized by its SCROLLER, never
 * by the viewport.
 *
 * Jon: *"[whitelabel] board columns are not centered in safari, may be all
 * mobile browsers."* The screenshot shows the board at rest with the Inbox
 * column clipped off the left edge and the next column peeking in on the right
 * — about 80px past where `snap-start` should have put it. The page itself is
 * fine: the floating header is inset symmetrically. Only the board's scroll
 * container is off.
 *
 * THE MECHANISM, which is a CSS Scroll Snap rule and not a browser bug.
 * The column was `w-[calc(100vw-2rem)]` inside a scroller with `px-4` and
 * `scroll-px-4`. That is only correct while the scroller spans the whole
 * viewport. Let anything inset it — a brand shell, a safe-area inset, a
 * scrollbar gutter — and the column becomes WIDER than the snapport, and the
 * spec then says any scroll position in which the snap area covers the
 * snapport is a valid snap position. The carousel is free to rest anywhere in
 * that range, and it does.
 *
 * Measured with Playwright at 402×874 (the device in the screenshot), varying
 * only the scroller's own width:
 *
 *   inset   scroller  snapport  column   Chromium rests at
 *   0       402       370       370      0     <- correct
 *   8       386       354       370      16    <- drifts by the overflow
 *   16      370       338       370      32
 *
 * And with the column sized from the scroller instead, column == snapport at
 * every inset and both engines rest at 0, with the column's left edge flush
 * with the board's padding.
 *
 * So the fix is not a magic number, it is removing a promise the column had no
 * business making: `100vw` is a claim about the VIEWPORT made by an element
 * that lives inside a scroller. The two can disagree, and when they do the
 * carousel stops snapping — which is why this reproduced on one deployment and
 * one device class and not in a desktop browser at a different width.
 *
 * This is a source check rather than a geometry test because jsdom does no
 * layout. The geometry is pinned by e2e/mobile-board-column-centring.spec.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BOARD = join(process.cwd(), 'components/project-status-board.tsx')

/** A viewport-relative width unit: the thing a carousel item must not use. */
const VIEWPORT_WIDTH_UNIT = /\bw-\[[^\]]*\b\d*\.?\d*(?:vw|dvw|svw|lvw)\b[^\]]*\]/

function boardSource(): string {
  return readFileSync(BOARD, 'utf8')
}

/** The className expression for one board column. */
function columnClasses(source: string): string {
  const marker = 'className={`flex h-full snap-start flex-col'
  const start = source.indexOf(marker)
  expect(start, 'the snap-start column className moved — update this test').toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('}`}', start))
}

describe('a snap carousel item is sized by its scroller (AWTD-1305)', () => {
  it('recognises a viewport-sized width — the scan is not vacuously green', () => {
    expect(VIEWPORT_WIDTH_UNIT.test('w-[calc(100vw-2rem)] shrink-0')).toBe(true)
    expect(VIEWPORT_WIDTH_UNIT.test('w-[calc(100dvw-2rem)]')).toBe(true)
    expect(VIEWPORT_WIDTH_UNIT.test('w-full shrink-0')).toBe(false)
    expect(VIEWPORT_WIDTH_UNIT.test('min-w-[18rem] max-w-[28rem] flex-1')).toBe(false)
  })

  it('AWTD-1305: the board column is not sized from the viewport', () => {
    const classes = columnClasses(boardSource())

    expect(
      VIEWPORT_WIDTH_UNIT.test(classes),
      'A column inside a scroll-snap container must be as wide as the SCROLLPORT, not the ' +
        'viewport. Wider than the snapport and the spec lets the carousel rest anywhere the ' +
        'snap area covers the snapport — which is AWTD-1305, the board sitting off-centre.',
    ).toBe(false)
  })

  it('AWTD-1305: the column still fills its scroller, so one column is one screen', () => {
    // The other half of the contract. Not sized from the viewport is easy to
    // satisfy by accident — by sizing it from nothing — and then the carousel
    // shows three half columns instead of one.
    const classes = columnClasses(boardSource())

    expect(classes).toMatch(/\bw-full\b/)
    expect(classes, 'a carousel item must not shrink, or several share one screen').toMatch(/\bshrink-0\b/)
  })

  it('AWTD-1305: the row does not force max-content, which is what re-opened the gap', () => {
    // `min-w-max` makes the row as wide as its children, so a column sized from
    // the viewport could overflow the scroller unnoticed. Without it the row
    // keeps the scroller's width and `w-full` on a column resolves against
    // THAT — which is the whole point.
    const source = boardSource()
    const marker = 'className={`flex h-full gap-3'
    const start = source.indexOf(marker)
    expect(start, 'the column row className moved — update this test').toBeGreaterThan(-1)

    expect(source.slice(start, source.indexOf('}`}', start))).not.toMatch(/\bmin-w-max\b/)
  })

  it('AWTD-1305: the scroll padding and the container padding still agree', () => {
    // `snap-start` aligns a column to the SNAPPORT's leading edge, which
    // scroll-padding insets. If that stopped matching the container's own
    // padding, the first column would rest at a different offset from every
    // other one — off-centre again, by a different route.
    const source = boardSource()
    const marker = 'data-testid="project-status-board"'
    const scroller = source.slice(source.lastIndexOf('className=', source.indexOf(marker)), source.indexOf(marker))

    expect(scroller).toMatch(/\bpx-4\b/)
    expect(scroller).toMatch(/\bscroll-px-4\b/)
  })
})
