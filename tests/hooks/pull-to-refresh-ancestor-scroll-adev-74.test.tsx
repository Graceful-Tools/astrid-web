/**
 * ADEV-74: on iPad the comments list (scrollTop 0, not itself scrollable) sat inside an outer
 * scrolling pane. Pull-to-refresh preventDefault'ed every downward drag, so the pane could
 * not be scrolled back up from the bottom comments.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

function Harness() {
  const { bindToElement } = usePullToRefresh({ onRefresh: () => {} })
  return (
    <div data-testid="pane" style={{ overflowY: 'auto' }}>
      <div data-testid="list" ref={bindToElement} />
    </div>
  )
}

function drag(el: HTMLElement, fromY: number, toY: number) {
  const touch = (y: number) => ({ clientY: y, clientX: 0, identifier: 1, target: el }) as unknown as Touch
  const start = new Event('touchstart', { bubbles: true, cancelable: true }) as any
  start.touches = [touch(fromY)]
  const move = new Event('touchmove', { bubbles: true, cancelable: true }) as any
  move.touches = [touch(toY)]
  el.dispatchEvent(start)
  el.dispatchEvent(move)
  return move as Event
}

describe('usePullToRefresh with a scrolled ancestor (ADEV-74)', () => {
  it('ADEV-74: does not block scrolling up when an outer pane is scrolled down', () => {
    const { getByTestId } = render(<Harness />)
    const pane = getByTestId('pane')
    Object.defineProperty(pane, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true })
    pane.scrollTop = 500
    const move = drag(getByTestId('list'), 100, 200)
    expect(move.defaultPrevented).toBe(false)
  })

  it('still pulls when every ancestor is at the top', () => {
    const { getByTestId } = render(<Harness />)
    const pane = getByTestId('pane')
    Object.defineProperty(pane, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true })
    pane.scrollTop = 0
    const move = drag(getByTestId('list'), 100, 200)
    expect(move.defaultPrevented).toBe(true)
  })
})
