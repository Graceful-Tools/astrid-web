import { describe, it, expect, vi, beforeEach , type Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClickOutside } from '@/hooks/shared/useClickOutside'
import { createRef } from 'react'

describe('useClickOutside', () => {
  let mockCallback: Mock

  beforeEach(() => {
    mockCallback = vi.fn()
  })

  it('should call callback when clicking outside the ref element', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback
      })
    )

    // Click outside
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should not call callback when clicking inside the ref element', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element
    document.body.appendChild(element)

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback
      })
    )

    // Click inside
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(mockCallback).not.toHaveBeenCalled()

    document.body.removeChild(element)
  })

  it('should handle multiple refs', () => {
    const ref1 = createRef<HTMLDivElement>()
    const ref2 = createRef<HTMLButtonElement>()
    const element1 = document.createElement('div')
    const element2 = document.createElement('button')
    ;(ref1 as any).current = element1
    ;(ref2 as any).current = element2
    document.body.appendChild(element1)
    document.body.appendChild(element2)

    renderHook(() =>
      useClickOutside([ref1, ref2], {
        onClickOutside: mockCallback
      })
    )

    // Click on first element
    element1.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).not.toHaveBeenCalled()

    // Click on second element
    element2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).not.toHaveBeenCalled()

    // Click outside both
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).toHaveBeenCalledTimes(1)

    document.body.removeChild(element1)
    document.body.removeChild(element2)
  })

  it('should call callback on Escape key', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback
      })
    )

    // Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should not call callback on Escape when ignoreEscape is true', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback,
        ignoreEscape: true
      })
    )

    // Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(mockCallback).not.toHaveBeenCalled()
  })

  it('should not call callback when enabled is false', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback,
        enabled: false
      })
    )

    // Click outside
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(mockCallback).not.toHaveBeenCalled()
  })

  it('should handle touch events', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback
      })
    )

    // Touch outside
    document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))

    expect(mockCallback).toHaveBeenCalledTimes(1)
  })

  it('should ignore clicks on elements matching ignoreSelectors (ID)', () => {
    const ref = createRef<HTMLDivElement>()
    const refElement = document.createElement('div')
    const ignoredElement = document.createElement('button')
    ignoredElement.id = 'ignore-me'
    ;(ref as any).current = refElement
    document.body.appendChild(refElement)
    document.body.appendChild(ignoredElement)

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback,
        ignoreSelectors: ['#ignore-me']
      })
    )

    // Click on ignored element
    ignoredElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).not.toHaveBeenCalled()

    // Click elsewhere
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).toHaveBeenCalledTimes(1)

    document.body.removeChild(refElement)
    document.body.removeChild(ignoredElement)
  })

  it('should ignore clicks on elements matching ignoreSelectors (class)', () => {
    const ref = createRef<HTMLDivElement>()
    const refElement = document.createElement('div')
    const ignoredElement = document.createElement('button')
    ignoredElement.className = 'ignore-class'
    ;(ref as any).current = refElement
    document.body.appendChild(refElement)
    document.body.appendChild(ignoredElement)

    renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback,
        ignoreSelectors: ['.ignore-class']
      })
    )

    // Click on ignored element
    ignoredElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).not.toHaveBeenCalled()

    document.body.removeChild(refElement)
    document.body.removeChild(ignoredElement)
  })

  it('should clean up event listeners on unmount', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() =>
      useClickOutside(ref, {
        onClickOutside: mockCallback
      })
    )

    unmount()

    // Should remove all 3 event listeners
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), true)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), true)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    removeEventListenerSpy.mockRestore()
  })

  it('should re-attach listeners when options change', () => {
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement('div')
    ;(ref as any).current = element

    const { rerender } = renderHook(
      ({ enabled }) => useClickOutside(ref, { onClickOutside: mockCallback, enabled }),
      { initialProps: { enabled: true } }
    )

    // Click outside (should trigger)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).toHaveBeenCalledTimes(1)

    // Disable
    rerender({ enabled: false })

    // Click outside (should NOT trigger)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).toHaveBeenCalledTimes(1) // Still 1

    // Re-enable
    rerender({ enabled: true })

    // Click outside (should trigger again)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(mockCallback).toHaveBeenCalledTimes(2)
  })
})
