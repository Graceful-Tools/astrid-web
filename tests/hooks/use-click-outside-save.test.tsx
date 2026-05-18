/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13 saga untangle. list-admin-settings.tsx had a
 * single click-outside-save useEffect serving BOTH the list-name and the
 * list-description inline editors, which blocked extracting either into
 * its own component. useClickOutsideSave is the per-section replacement:
 * one ref, one editing flag, one save callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useClickOutsideSave } from '@/hooks/use-click-outside-save'

vi.mock('@/lib/layout-detection', () => ({
  shouldIgnoreTouchDuringKeyboard: () => false,
  needsAggressiveKeyboardProtection: () => false,
  getFocusProtectionThreshold: () => 300,
}))

let inside: HTMLDivElement
let outside: HTMLDivElement

beforeEach(() => {
  inside = document.createElement('div')
  outside = document.createElement('div')
  document.body.appendChild(inside)
  document.body.appendChild(outside)
})

afterEach(() => {
  inside.remove()
  outside.remove()
})

describe('useClickOutsideSave', () => {
  it('does not save when not editing, even on an outside click', () => {
    const onSave = vi.fn()
    renderHook(() => useClickOutsideSave({ current: inside }, false, onSave))

    fireEvent.mouseDown(outside)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves on a mousedown outside the ref while editing', () => {
    const onSave = vi.fn()
    renderHook(() => useClickOutsideSave({ current: inside }, true, onSave))

    fireEvent.mouseDown(outside)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not save on a mousedown inside the ref', () => {
    const onSave = vi.fn()
    renderHook(() => useClickOutsideSave({ current: inside }, true, onSave))

    fireEvent.mouseDown(inside)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves on a touchstart outside the ref while editing', () => {
    const onSave = vi.fn()
    renderHook(() => useClickOutsideSave({ current: inside }, true, onSave))

    fireEvent.touchStart(outside)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('removes its listeners on unmount', () => {
    const onSave = vi.fn()
    const { unmount } = renderHook(() =>
      useClickOutsideSave({ current: inside }, true, onSave)
    )

    unmount()
    fireEvent.mouseDown(outside)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('is independent per instance — two editors do not cross-fire', () => {
    const saveA = vi.fn()
    const saveB = vi.fn()
    const refA = { current: inside }
    const refB = { current: outside }

    renderHook(() => {
      useClickOutsideSave(refA, true, saveA)
      useClickOutsideSave(refB, false, saveB)
    })

    // Click inside B (which is outside A). A is editing → saves; B is not.
    fireEvent.mouseDown(outside)
    expect(saveA).toHaveBeenCalledTimes(1)
    expect(saveB).not.toHaveBeenCalled()
  })
})
