/**
 * A commit that closes its own editor must run exactly once.
 *
 * Regression for the web-desktop PUT storm (task pending — filed from this
 * fix; first seen as 14 duplicate "changed task name" comments on task
 * 2f1ec1af, 987 PUTs in 46s). Every task-detail save handler is registered as
 * its editor's commit AND ends its editor itself:
 *
 *   handleSaveTitle = () => { onUpdate(...); setEditingTitle(false) }
 *
 * `endEditing` ran that commit INSIDE its setState updater. React evaluates a
 * nested updater eagerly against the last-rendered state — the outer update is
 * not enqueued yet — so the re-entrant `endEditing('title')` still saw the
 * editor as active, committed again, and recursed until the call stack
 * overflowed, firing one PUT per level.
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useEditingSession, type EditingSession } from '@/hooks/use-editing-session'

const RECURSION_CEILING = 50

function Harness({ commit }: { commit: (session: EditingSession) => void }) {
  const session = useEditingSession()
  React.useEffect(() => {
    session.registerCommit('title', () => commit(session))
  })
  return (
    <div>
      <button onClick={() => session.beginEditing('title')}>open</button>
      <button onClick={() => session.endEditing('title')}>save</button>
      <span data-testid="state">{session.isEditing('title') ? 'open' : 'closed'}</span>
    </div>
  )
}

describe('editing session: a commit that ends its own editor', () => {
  it('runs exactly once when endEditing is re-entered from the commit', () => {
    let commits = 0
    const commit = (session: EditingSession) => {
      commits += 1
      // Bounded so a regression fails with a count, not a stack overflow.
      if (commits < RECURSION_CEILING) session.endEditing('title')
    }
    const { rerender } = render(<Harness commit={commit} />)

    act(() => { fireEvent.click(screen.getByText('open')) })
    // A quiet render between open and save leaves the fiber with no pending
    // lanes, which is what lets React evaluate the next setState eagerly —
    // the condition the task detail is in when a user presses Enter.
    rerender(<Harness commit={commit} />)
    act(() => { fireEvent.click(screen.getByText('save')) })

    expect(commits, 'the commit re-entered itself — this is the PUT storm').toBe(1)
    expect(screen.getByTestId('state').textContent).toBe('closed')
  })

  it('runs exactly once when beginEditing(other) is re-entered from the commit', () => {
    let commits = 0
    const commit = (session: EditingSession) => {
      commits += 1
      if (commits < RECURSION_CEILING) session.beginEditing('description')
    }
    const { rerender } = render(<Harness commit={commit} />)

    act(() => { fireEvent.click(screen.getByText('open')) })
    rerender(<Harness commit={commit} />)
    act(() => { fireEvent.click(screen.getByText('save')) })

    expect(commits).toBe(1)
  })
})
