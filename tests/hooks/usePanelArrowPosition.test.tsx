import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePanelArrowPosition } from '@/hooks/usePanelArrowPosition'

function mockBoundingRect(el: HTMLElement, rect: Partial<DOMRect>) {
  const full: DOMRect = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  el.getBoundingClientRect = () => full
}

describe('usePanelArrowPosition', () => {
  let source: HTMLElement
  let panel: HTMLElement

  beforeEach(() => {
    source = document.createElement('div')
    source.setAttribute('data-test-source', 'true')
    document.body.appendChild(source)

    panel = document.createElement('div')
    document.body.appendChild(panel)
  })

  afterEach(() => {
    source.remove()
    panel.remove()
    vi.restoreAllMocks()
  })

  it('returns initialTop when source element is not found', () => {
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-missing]',
        getPanelElement: () => panel,
        initialTop: 80,
      }),
    )
    expect(result.current).toBe(80)
  })

  it('computes arrowTop using card center minus panel top minus offset', () => {
    mockBoundingRect(source, { top: 200, height: 60 })   // center = 230
    mockBoundingRect(panel, { top: 100, height: 500 })   // relative = 130; minus 10 offset = 120
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-test-source]',
        getPanelElement: () => panel,
      }),
    )
    expect(result.current).toBe(120)
  })

  it('clamps to minTop when computed position is too low', () => {
    mockBoundingRect(source, { top: 0, height: 10 })      // center = 5
    mockBoundingRect(panel, { top: 0, height: 500 })      // relative = 5; 5-10=-5 → clamps to 20
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-test-source]',
        getPanelElement: () => panel,
      }),
    )
    expect(result.current).toBe(20)
  })

  it('clamps to maxTop when computed position exceeds panel minus inset', () => {
    mockBoundingRect(source, { top: 1000, height: 10 })   // center = 1005
    mockBoundingRect(panel, { top: 0, height: 200 })      // maxTop = 200 - 40 = 160
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-test-source]',
        getPanelElement: () => panel,
      }),
    )
    expect(result.current).toBe(160)
  })

  it('returns initial value when source has zero height (not yet laid out)', () => {
    mockBoundingRect(source, { top: 100, height: 0 })
    mockBoundingRect(panel, { top: 0, height: 500 })
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-test-source]',
        getPanelElement: () => panel,
        initialTop: 77,
      }),
    )
    expect(result.current).toBe(77)
  })

  it('recomputes when window resize fires', () => {
    mockBoundingRect(source, { top: 200, height: 60 })
    mockBoundingRect(panel, { top: 100, height: 500 })
    const { result } = renderHook(() =>
      usePanelArrowPosition({
        sourceSelector: '[data-test-source]',
        getPanelElement: () => panel,
      }),
    )
    expect(result.current).toBe(120)

    mockBoundingRect(source, { top: 300, height: 60 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    // center=330, relative=230, minus 10 = 220
    expect(result.current).toBe(220)
  })
})
