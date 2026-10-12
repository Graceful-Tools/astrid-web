/**
 * @vitest-environment jsdom
 */

/**
 * The iOS-style edge swipe (AWTD-1173).
 *
 * Jon, choosing the sidebar pattern: *"(A/B) but keep integration like iOS"*,
 * and earlier, *"iOS interaction open close feel is best feel with swipe
 * interaction"*. Web's sidebar already has that gesture — a swipe right opens
 * it, a swipe left dismisses it, and a swipe that STARTS AT THE LEFT EDGE needs
 * less travel, which is the part that makes it feel like iOS rather than like a
 * generic drag.
 *
 * Nothing tested it. `edgeZone` and `edgeThreshold` appeared in no test in the
 * repo, so the feel Jon picked rested on two default arguments that any tidy-up
 * could have removed without a single failure. That is the same shape as
 * AWTD-1177, where the thing being asked for was already true and simply
 * unprotected.
 *
 * Pinned here:
 *   - an edge swipe completes on less travel than a mid-screen one;
 *   - the easier threshold applies RIGHTWARD only — a leftward swipe from the
 *     edge is an ordinary swipe, or dismissing a sidebar would be hair-trigger;
 *   - the edge flag does not leak into the next gesture;
 *   - vertical swipes are unaffected by any of it.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useSwipe } from '@/hooks/use-swipe'

const EDGE_ZONE = 20
const EDGE_THRESHOLD = 30
const THRESHOLD = 50

function Swipeable(props: Parameters<typeof useSwipe>[0]) {
  const handlers = useSwipe(props, { threshold: THRESHOLD })
  return <div data-testid="surface" {...handlers} style={{ width: 400, height: 400 }} />
}

/** One gesture: start at `from`, end at `to`, on the same vertical line unless given. */
function swipe(
  element: HTMLElement,
  from: { x: number; y?: number },
  to: { x: number; y?: number },
) {
  const start = { clientX: from.x, clientY: from.y ?? 100 }
  const end = { clientX: to.x, clientY: to.y ?? 100 }
  fireEvent.touchStart(element, { touches: [start] })
  fireEvent.touchMove(element, { touches: [end] })
  fireEvent.touchEnd(element, { changedTouches: [end] })
}

function setup() {
  const onSwipeRight = vi.fn()
  const onSwipeLeft = vi.fn()
  const onSwipeDown = vi.fn()
  const { getByTestId } = render(
    <Swipeable onSwipeRight={onSwipeRight} onSwipeLeft={onSwipeLeft} onSwipeDown={onSwipeDown} />,
  )
  return { surface: getByTestId('surface'), onSwipeRight, onSwipeLeft, onSwipeDown }
}

describe('useSwipe edge gesture (AWTD-1173)', () => {
  it('opens on a SHORT swipe that starts at the left edge', () => {
    const { surface, onSwipeRight } = setup()
    // 40px of travel: past the 30px edge threshold, short of the ordinary 50px.
    swipe(surface, { x: EDGE_ZONE - 5 }, { x: EDGE_ZONE - 5 + 40 })

    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('does NOT open on the same short swipe from mid-screen', () => {
    // The whole point of the edge zone: the same 40px elsewhere is a scroll or
    // a stray drag, not an intent to open the sidebar.
    const { surface, onSwipeRight } = setup()
    swipe(surface, { x: 200 }, { x: 240 })

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('still opens on a long swipe from mid-screen', () => {
    const { surface, onSwipeRight } = setup()
    swipe(surface, { x: 200 }, { x: 200 + THRESHOLD + 10 })

    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('gives no edge discount to a LEFTWARD swipe that began at the edge', () => {
    // Dismissing is a leftward swipe. If starting near the edge halved its
    // threshold, the open sidebar would close on the smallest stray drag.
    const { surface, onSwipeLeft } = setup()
    swipe(surface, { x: EDGE_ZONE - 5 }, { x: 0 })

    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('treats a swipe starting just OUTSIDE the edge zone as ordinary', () => {
    const { surface, onSwipeRight } = setup()
    swipe(surface, { x: EDGE_ZONE + 1 }, { x: EDGE_ZONE + 1 + EDGE_THRESHOLD + 5 })

    expect(onSwipeRight).not.toHaveBeenCalled()
  })

  it('does not carry the edge discount into the NEXT gesture', () => {
    // isEdgeSwipeRef is a ref; if it were not reset, one edge swipe would make
    // every later mid-screen swipe hair-trigger for the life of the component.
    const { surface, onSwipeRight } = setup()
    swipe(surface, { x: 0 }, { x: 40 })
    expect(onSwipeRight).toHaveBeenCalledTimes(1)

    swipe(surface, { x: 200 }, { x: 240 })
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('leaves vertical swipes on the ordinary threshold', () => {
    const { surface, onSwipeDown } = setup()
    // Starting at the edge, but the movement is vertical: no discount applies.
    swipe(surface, { x: 5, y: 100 }, { x: 5, y: 100 + EDGE_THRESHOLD + 5 })
    expect(onSwipeDown).not.toHaveBeenCalled()

    swipe(surface, { x: 5, y: 100 }, { x: 5, y: 100 + THRESHOLD + 10 })
    expect(onSwipeDown).toHaveBeenCalledTimes(1)
  })
})
