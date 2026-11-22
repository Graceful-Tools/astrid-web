/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-177 — the details arrow follows a card that moves column, and the board scrolls to it.
 *
 * When the OPEN task's card changes column (completed into Done, marked to-do, a status set from
 * the details) the board scrolls so the new column sits on the side the card was opened on, clear
 * of the panel; the column scrolls to the card; the side is decided again. A different task is not
 * a move. Mirrors astrid-ios BoardCardCallout.moved / scrollEdge.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'

vi.mock('@/components/TaskManager/lazy-panels', () => ({
  LazyTaskDetail: () => <div data-testid="detail" />,
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
  boxes.set('board', { left: 0, top: 0, width: 1400, height: 900 })
})

afterEach(() => {
  vi.restoreAllMocks()
  boxes.clear()
  document.body.innerHTML = ''
})

function board() {
  const el = document.createElement('div')
  el.setAttribute('data-board-callout-viewport', '')
  el.setAttribute('data-box', 'board')
  let scrollLeft = 0
  Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v: number) => { scrollLeft = v } })
  const column = (index: number, box: Box) => {
    const col = document.createElement('div')
    col.setAttribute('data-column-index', String(index))
    col.setAttribute('data-box', `col-${index}`)
    boxes.set(`col-${index}`, box)
    el.appendChild(col)
    return col
  }
  const card = (id: string, box: Box, into: HTMLElement) => {
    const c = document.createElement('div')
    c.setAttribute('data-task-id', id)
    c.setAttribute('data-box', `card-${id}`)
    boxes.set(`card-${id}`, box)
    into.appendChild(c)
    return c
  }
  document.body.appendChild(el)
  return { el, column, card }
}

describe('ADEV-177: the callout follows the open card into another column', () => {
  it('scrolls the new column to the edge away from the panel, scrolls to the card, re-picks the side', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const b = board()
    const first = b.column(0, { left: -900, top: 0, width: 300, height: 900 })
    const last = b.column(1, { left: 1100, top: 0, width: 300, height: 900 })
    const card = b.card('task-1', { left: 1110, top: 300, width: 280, height: 64 }, last)

    const props = { taskId: 'task-1', onClose: vi.fn(), paneProps: {} as never }
    const view = render(<BoardTaskCallout {...props} anchor={card} />)
    const callout = document.querySelector('[data-board-task-callout]') as HTMLElement
    expect(callout.getAttribute('data-callout-side')).toBe('left')

    // Completed into Done: the same task's card now lives in the first column, off-screen left.
    card.remove()
    const moved = b.card('task-1', { left: -890, top: 120, width: 280, height: 64 }, first)
    act(() => { view.rerender(<BoardTaskCallout {...props} anchor={moved} />) })

    // Opened on the card's left: the column goes to the board's right edge, clear of the panel.
    expect(b.el.scrollLeft).toBe(-600 - 1400)
    expect(scrollIntoView).toHaveBeenCalled()
    // Side decided again from the card's new place (it was 'left' before the move).
    expect(callout.getAttribute('data-callout-side')).toBe('right')
  })

  it('does not scroll when a different task opens', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const b = board()
    const first = b.column(0, { left: 0, top: 0, width: 300, height: 900 })
    const last = b.column(1, { left: 1100, top: 0, width: 300, height: 900 })
    const one = b.card('task-1', { left: 10, top: 100, width: 280, height: 64 }, first)
    const two = b.card('task-2', { left: 1110, top: 100, width: 280, height: 64 }, last)
    const props = { onClose: vi.fn(), paneProps: {} as never }
    const view = render(<BoardTaskCallout {...props} taskId="task-1" anchor={one} />)
    act(() => { view.rerender(<BoardTaskCallout {...props} taskId="task-2" anchor={two} />) })
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(b.el.scrollLeft).toBe(0)
  })
})
