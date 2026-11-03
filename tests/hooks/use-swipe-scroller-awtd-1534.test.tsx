/**
 * @vitest-environment jsdom
 */

/**
 * Scrolling a trade-off grid sideways closed the task (AWTD-1534).
 *
 * Jon: "Left to right movement on comment with trafficlight table caused task
 * details to close." The task panel's swipe-right-to-dismiss read the finger
 * dragging the grid's columns as a dismiss. A gesture that starts inside
 * something that scrolls sideways belongs to that scroller. So does a touch on
 * a portalled dialog, such as the full-screen grid: React bubbles its events
 * through the panel even though the dialog is not inside it.
 */

import React from 'react'
import { createPortal } from 'react-dom'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useSwipe } from '@/hooks/use-swipe'

function Panel({ onSwipeRight, onSwipeProgress }: { onSwipeRight: () => void; onSwipeProgress?: () => void }) {
  const handlers = useSwipe({ onSwipeRight, onSwipeProgress }, { threshold: 50 })
  return (
    <div data-testid="panel" {...handlers}>
      <p data-testid="text">Plain comment text</p>
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <span data-testid="cell">cell</span>
      </div>
      <div data-testid="fits" style={{ overflowX: 'auto' }}>
        <span data-testid="fits-cell">cell</span>
      </div>
      {createPortal(<div data-testid="portalled">dialog</div>, document.body)}
    </div>
  )
}

/** jsdom lays nothing out, so give the scroller content wider than itself. */
function makeScrollable(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
}

function swipeRight(el: HTMLElement, fromX = 100, toX = 260) {
  fireEvent.touchStart(el, { touches: [{ clientX: fromX, clientY: 100 }] })
  fireEvent.touchMove(el, { touches: [{ clientX: toX, clientY: 102 }] })
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: toX, clientY: 102 }] })
}

function setup() {
  const onSwipeRight = vi.fn()
  const onSwipeProgress = vi.fn()
  const utils = render(<Panel onSwipeRight={onSwipeRight} onSwipeProgress={onSwipeProgress} />)
  makeScrollable(utils.getByTestId('scroller'), 900, 300)
  makeScrollable(utils.getByTestId('fits'), 300, 300)
  return { ...utils, onSwipeRight, onSwipeProgress }
}

describe('AWTD-1534 a sideways scroller keeps its own gesture', () => {
  it('a swipe on plain text still dismisses', () => {
    const { getByTestId, onSwipeRight } = setup()
    swipeRight(getByTestId('text'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('a swipe that starts inside a grid wider than the panel does not dismiss or drag the panel', () => {
    const { getByTestId, onSwipeRight, onSwipeProgress } = setup()
    swipeRight(getByTestId('cell'))
    expect(onSwipeRight).not.toHaveBeenCalled()
    expect(onSwipeProgress).not.toHaveBeenCalled()
  })

  it('a grid that fits needs no sideways scroll, so the swipe still dismisses', () => {
    const { getByTestId, onSwipeRight } = setup()
    swipeRight(getByTestId('fits-cell'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('an edge swipe still goes back, even over a scroller', () => {
    const { getByTestId, onSwipeRight } = setup()
    swipeRight(getByTestId('cell'), 5, 120)
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('a touch on a portalled dialog does not reach the panel behind it', () => {
    const { getByTestId, onSwipeRight } = setup()
    swipeRight(getByTestId('portalled'), 5, 260)
    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('the next gesture on plain text is tracked again', () => {
    const { getByTestId, onSwipeRight } = setup()
    swipeRight(getByTestId('cell'))
    swipeRight(getByTestId('text'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })
})
