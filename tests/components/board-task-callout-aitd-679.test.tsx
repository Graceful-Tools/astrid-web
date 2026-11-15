/**
 * @vitest-environment jsdom
 */

/**
 * AITD-679 — a board card's task details open as a callout beside the card.
 *
 * Jon: "Stop opening board task details by expanding the board task. Open, just like task details
 * from a task row, but pick the left or right side based on the spacing on screen."
 *
 * BoardTaskCallout measures the card, the board's top edge, the window and its own width, and
 * places itself with core rows::callout (lib/callout-placement.ts, held to the core's fixture in
 * tests/lib/callout-placement-aitd-679.test.ts). These tests pin the measuring and the wiring:
 * that it opens on the roomier side, points its arrow at the card, stays under the board's top
 * edge, and closes on Escape — but leaves Escape to a field being edited.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/components/TaskManager/lazy-panels', () => ({
  LazyTaskDetail: ({ calloutArrow, onClose }: { calloutArrow?: unknown; onClose: () => void }) => (
    <div data-testid="detail" data-arrow={JSON.stringify(calloutArrow)}>
      <input data-testid="field" />
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

import { BoardTaskCallout } from '@/components/TaskManager/BoardTaskCallout'

type Box = { left: number; top: number; width: number; height: number }
const boxes = new Map<string, Box>()

function rect({ left, top, width, height }: Box): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const key = this.getAttribute('data-box') ?? (this.hasAttribute('data-board-task-callout') ? 'callout' : '')
    return rect(boxes.get(key) ?? { left: 0, top: 0, width: 0, height: 0 })
  })
  boxes.set('callout', { left: 0, top: 0, width: 420, height: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
  boxes.clear()
  document.body.innerHTML = ''
})

/** A board scroller starting at `boardTop`, holding one card at `card`. */
function mountBoard(card: Box, boardTop = 0): HTMLElement {
  boxes.set('board', { left: 0, top: boardTop, width: 1400, height: 900 - boardTop })
  boxes.set('card', card)
  const board = document.createElement('div')
  board.setAttribute('data-board-callout-viewport', '')
  board.setAttribute('data-box', 'board')
  const el = document.createElement('div')
  el.setAttribute('data-task-id', 'task-1')
  el.setAttribute('data-box', 'card')
  board.appendChild(el)
  document.body.appendChild(board)
  return el
}

function renderCallout(anchor: HTMLElement | null, onClose = vi.fn(), closing = false) {
  render(
    <BoardTaskCallout taskId="task-1" anchor={anchor} onClose={onClose} closing={closing} paneProps={{} as never} />,
  )
  const callout = document.querySelector('[data-board-task-callout]') as HTMLElement
  const arrow = JSON.parse(screen.getByTestId('detail').getAttribute('data-arrow') || 'null')
  return { callout, arrow, onClose }
}

describe('BoardTaskCallout (AITD-679)', () => {
  it('opens on the LEFT of a card in a right-hand column, arrow at the card', () => {
    const card = mountBoard({ left: 1000, top: 300, width: 320, height: 64 })
    const { callout, arrow } = renderCallout(card)

    expect(callout.getAttribute('data-callout-side')).toBe('left')
    // Its right edge a gutter clear of the card: 1000 - 8 - 420.
    expect(callout.style.left).toBe('572px')
    // As tall as the board allows, a gutter from each edge.
    expect(callout.style.top).toBe('8px')
    expect(callout.style.height).toBe('884px')
    // The card's middle is 332; the callout starts at 8.
    expect(arrow).toEqual({ side: 'left', offset: 324 })
    expect(callout.className).toMatch(/\btask-panel-callout\b/)
  })

  it('opens on the RIGHT of a card in a left-hand column', () => {
    const card = mountBoard({ left: 40, top: 300, width: 320, height: 64 })
    const { callout, arrow } = renderCallout(card)

    expect(callout.getAttribute('data-callout-side')).toBe('right')
    expect(callout.style.left).toBe('368px')
    expect(arrow.side).toBe('right')
  })

  it('stays under the board top edge (the header), not the window top', () => {
    const card = mountBoard({ left: 40, top: 200, width: 320, height: 64 }, 120)
    const { callout, arrow } = renderCallout(card)

    expect(callout.style.top).toBe('128px')
    expect(callout.style.height).toBe(`${900 - 120 - 16}px`)
    expect(arrow.offset).toBe(232 - 128)
  })

  it('finds the card by data-task-id when the element it was given is gone', () => {
    mountBoard({ left: 1000, top: 300, width: 320, height: 64 })
    const { callout } = renderCallout(null)
    expect(callout.getAttribute('data-callout-side')).toBe('left')
  })

  it('closes on Escape', () => {
    const card = mountBoard({ left: 40, top: 300, width: 320, height: 64 })
    const { onClose } = renderCallout(card)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves Escape to a field being edited', () => {
    const card = mountBoard({ left: 40, top: 300, width: 320, height: 64 })
    const { onClose } = renderCallout(card)
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('DS32: keeps the side chosen at the tap while the board scrolls, instead of hopping', () => {
    // Slightly more room on the right at the tap: it opens right.
    const card = mountBoard({ left: 500, top: 300, width: 320, height: 64 })
    const { callout } = renderCallout(card)
    expect(callout.getAttribute('data-callout-side')).toBe('right')

    // The board scrolls the card toward the right edge: more room on the left now.
    boxes.set('card', { left: 900, top: 300, width: 320, height: 64 })
    act(() => { document.dispatchEvent(new Event('scroll')) })
    expect(callout.getAttribute('data-callout-side')).toBe('right')
    // Still re-placed for that side: clamped against the right edge, 1400 - 8 - 420.
    expect(callout.style.left).toBe('972px')
  })

  it('DS32: the reveal grows out of the edge that faces the card, and plays backwards on close', () => {
    const card = mountBoard({ left: 1000, top: 300, width: 320, height: 64 })
    const { callout } = renderCallout(card, vi.fn(), true)
    expect(callout.className).toMatch(/\btask-panel-callout-left\b/)
    expect(callout.className).toMatch(/\btask-panel-callout-closing\b/)
  })
})
