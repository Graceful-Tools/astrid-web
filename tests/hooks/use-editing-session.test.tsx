import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEditingSession } from '@/hooks/use-editing-session'

/**
 * Task 7b60c7c5 — the React binding. The machine itself is covered in
 * tests/lib/editing-session.test.ts; this pins that the hook actually performs
 * the commit the machine reports, and that "navigating away saves".
 */
describe('useEditingSession (task 7b60c7c5)', () => {
  it('never reports two editors open — the reported bug', () => {
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.beginEditing('lists'))
    act(() => result.current.beginEditing('title'))

    // "edit a list and tap the title" — the exact repro from the report.
    expect(result.current.isEditing('title')).toBe(true)
    expect(result.current.isEditing('lists')).toBe(false)
  })

  it('commits the editor it closes on hand-off', () => {
    const saveLists = vi.fn()
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('lists', saveLists))
    act(() => result.current.beginEditing('lists'))
    act(() => result.current.beginEditing('title'))

    expect(saveLists).toHaveBeenCalledTimes(1)
  })

  it('does not commit an editor that registered nothing — pickers save on selection', () => {
    const saveTitle = vi.fn()
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('title', saveTitle))
    act(() => result.current.beginEditing('when'))
    act(() => result.current.beginEditing('title'))

    // Closing `when` must not throw or reach for a handler it never had.
    expect(saveTitle).not.toHaveBeenCalled()
    expect(result.current.isEditing('title')).toBe(true)
  })

  it('ignores the stale end that a save handler fires after hand-off', () => {
    // handleSaveTitle ends with setEditingTitle(false). During a hand-off the
    // session has already moved on, so that end must not close the NEW editor.
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('title', () => result.current.endEditing('title')))
    act(() => result.current.beginEditing('title'))
    act(() => result.current.beginEditing('assignee'))

    expect(result.current.isEditing('assignee')).toBe(true)
  })

  it('commits on explicit end', () => {
    const saveTitle = vi.fn()
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('title', saveTitle))
    act(() => result.current.beginEditing('title'))
    act(() => result.current.endEditing('title'))

    expect(saveTitle).toHaveBeenCalledTimes(1)
    expect(result.current.isEditing('title')).toBe(false)
  })

  it('does NOT commit on explicit cancel — the only path that discards', () => {
    const saveTitle = vi.fn()
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('title', saveTitle))
    act(() => result.current.beginEditing('title'))
    act(() => result.current.cancelEditing('title'))

    expect(saveTitle).not.toHaveBeenCalled()
    expect(result.current.isEditing('title')).toBe(false)
  })

  it('saves when the page is backgrounded', () => {
    const saveDescription = vi.fn()
    const { result } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('description', saveDescription))
    act(() => result.current.beginEditing('description'))

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(saveDescription).toHaveBeenCalledTimes(1)
  })

  it('saves on unmount — navigating away is not discarding', () => {
    const saveTitle = vi.fn()
    const { result, unmount } = renderHook(() => useEditingSession())

    act(() => result.current.registerCommit('title', saveTitle))
    act(() => result.current.beginEditing('title'))
    unmount()

    expect(saveTitle).toHaveBeenCalledTimes(1)
  })
})
