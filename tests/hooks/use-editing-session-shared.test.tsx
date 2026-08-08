/**
 * One editing session across the whole app, not one per component (task 7b60c7c5).
 *
 * `useEditingSession` is a plain hook, so every caller got its own machine. That
 * made "exactly one editor at a time" true inside the task detail and nowhere
 * else: migrating the list editors by calling the hook again would have created
 * a second independent session, and a list editor plus a task-detail editor
 * could both be open — the same failure the machine exists to prevent, one
 * level up.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  EditingSessionProvider,
  useSharedEditingSession,
} from '@/hooks/use-editing-session'

/** A minimal editor: opens on click, commits its buffer on hand-off. */
function Editor({ id, onCommit }: { id: string; onCommit: () => void }) {
  const session = useSharedEditingSession()

  React.useEffect(() => {
    session.registerCommit(id, onCommit)
  }, [session, id, onCommit])

  return (
    <div>
      <button onClick={() => session.beginEditing(id)}>open {id}</button>
      <button onClick={() => session.cancelEditing(id)}>cancel {id}</button>
      <span data-testid={`state-${id}`}>{session.isEditing(id) ? 'open' : 'closed'}</span>
    </div>
  )
}

describe('shared editing session (task 7b60c7c5)', () => {
  const commitA = vi.fn()
  const commitB = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  const renderPair = () =>
    render(
      <EditingSessionProvider>
        {/* Two SEPARATE components — the case a per-component hook could not cover. */}
        <Editor id="a" onCommit={commitA} />
        <Editor id="b" onCommit={commitB} />
      </EditingSessionProvider>,
    )

  it('opening an editor in one component closes one in another', () => {
    renderPair()

    fireEvent.click(screen.getByText('open a'))
    expect(screen.getByTestId('state-a')).toHaveTextContent('open')

    fireEvent.click(screen.getByText('open b'))

    expect(screen.getByTestId('state-a')).toHaveTextContent('closed')
    expect(screen.getByTestId('state-b')).toHaveTextContent('open')
  })

  it('the hand-off COMMITS the editor it closed, per the universal policy', () => {
    renderPair()

    fireEvent.click(screen.getByText('open a'))
    fireEvent.click(screen.getByText('open b'))

    expect(commitA).toHaveBeenCalledTimes(1)
    expect(commitB).not.toHaveBeenCalled()
  })

  it('cancel is still the only transition that discards', () => {
    renderPair()

    fireEvent.click(screen.getByText('open a'))
    fireEvent.click(screen.getByText('cancel a'))

    expect(commitA).not.toHaveBeenCalled()
    expect(screen.getByTestId('state-a')).toHaveTextContent('closed')
  })

  it('re-opening the already-active editor does not commit it', () => {
    renderPair()

    fireEvent.click(screen.getByText('open a'))
    fireEvent.click(screen.getByText('open a'))

    expect(commitA).not.toHaveBeenCalled()
    expect(screen.getByTestId('state-a')).toHaveTextContent('open')
  })

  it('falls back to a private session when no provider is mounted', () => {
    // Deliberate: the ~40 existing task-detail call sites and their tests must
    // keep working without every one of them being wrapped in a provider.
    render(
      <>
        <Editor id="a" onCommit={commitA} />
        <Editor id="b" onCommit={commitB} />
      </>,
    )

    fireEvent.click(screen.getByText('open a'))
    fireEvent.click(screen.getByText('open b'))

    // Independent sessions — both stay open, and nothing was handed off.
    expect(screen.getByTestId('state-a')).toHaveTextContent('open')
    expect(screen.getByTestId('state-b')).toHaveTextContent('open')
    expect(commitA).not.toHaveBeenCalled()
  })

  it('backgrounding commits whatever is open, wherever it lives', () => {
    renderPair()

    fireEvent.click(screen.getByText('open a'))

    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(commitA).toHaveBeenCalledTimes(1)
  })
})
