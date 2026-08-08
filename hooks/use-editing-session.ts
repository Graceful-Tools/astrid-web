import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  IDLE,
  begin,
  cancel as cancelEditor,
  commitAll,
  end,
  isActive,
  type EditingSessionState,
  type EditorId,
} from '@/lib/editing-session'

/**
 * React binding for the {@link IDLE} editing-session machine (task 7b60c7c5).
 *
 * Editors do not track their own `isEditing` any more; they ask the session.
 * Because `begin` closes the previous editor by construction, opening any
 * editor commits and closes the active one whether or not the call site
 * remembered to — which is the entire point.
 *
 * Editors with a **pending buffer** (a title being typed, a description) must
 * register a commit handler so the hand-off saves rather than discards.
 * Picker-style editors that already commit on selection (date, time, priority,
 * repeat) register nothing — for them, closing IS the whole story.
 *
 * The registry is a ref, not state: handlers are re-created on every render of
 * the consumer, and re-running the session on each would be pointless churn.
 */
export interface EditingSession {
  activeEditor: EditorId | null
  /** True when `id` is the one open editor. */
  isEditing: (id: EditorId) => boolean
  /** Open `id`, committing and closing whatever was active. */
  beginEditing: (id: EditorId) => void
  /** Commit `id` and close. Stale calls from an already-handed-off editor are ignored. */
  endEditing: (id: EditorId) => void
  /** Revert `id` and close — the only path that discards. */
  cancelEditing: (id: EditorId) => void
  /** Register the commit for an editor that holds a pending buffer. */
  registerCommit: (id: EditorId, commit: () => void) => void
}

export function useEditingSession(): EditingSession {
  const [state, setState] = useState<EditingSessionState>(IDLE)
  const commits = useRef(new Map<EditorId, () => void>())
  // Mirror of `state` readable outside the setState updater. The unmount path
  // needs it: React drops a setState updater once the component is gone, so
  // "navigating away saves" would silently not save.
  const activeRef = useRef<EditorId | null>(null)
  activeRef.current = state.activeEditor

  // The machine reports which editor to commit; performing it is ours.
  const beginEditing = useCallback((id: EditorId) => {
    setState(current => {
      const next = begin(current, id)
      if (next.commit) commits.current.get(next.commit)?.()
      return next.state
    })
  }, [])

  const endEditing = useCallback((id: EditorId) => {
    setState(current => {
      const next = end(current, id)
      if (next.commit) commits.current.get(next.commit)?.()
      return next.state
    })
  }, [])

  const cancelEditing = useCallback((id: EditorId) => {
    setState(current => cancelEditor(current, id).state)
  }, [])

  const registerCommit = useCallback((id: EditorId, commit: () => void) => {
    commits.current.set(id, commit)
  }, [])

  // Navigating away and backgrounding SAVE — the universal policy applied to
  // the events that are nobody's editor in particular.
  useEffect(() => {
    const commitOnLeave = () => {
      const next = commitAll({ activeEditor: activeRef.current })
      activeRef.current = null
      if (next.commit) commits.current.get(next.commit)?.()
      setState(next.state)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') commitOnLeave()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', commitOnLeave)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', commitOnLeave)
      // Unmounting is navigating away: save, don't discard.
      commitOnLeave()
    }
  }, [])

  const isEditingId = useCallback(
    (id: EditorId) => isActive(state, id),
    [state],
  )

  return {
    activeEditor: state.activeEditor,
    isEditing: isEditingId,
    beginEditing,
    endEditing,
    cancelEditing,
    registerCommit,
  }
}

// ─── One session for the whole app ────────────────────────────────

/**
 * The session shared across components (task 7b60c7c5).
 *
 * `useEditingSession` is a plain hook, so every caller gets its OWN machine.
 * That made "exactly one editor at a time" true inside the task detail and
 * nowhere else — migrating the list editors by calling the hook again would
 * have created a second independent session, and a list editor plus a
 * task-detail editor could both be open. Mutual exclusion has to span the tree
 * for the guarantee to mean anything.
 */
const EditingSessionContext = createContext<EditingSession | null>(null)

export function EditingSessionProvider({ children }: { children: React.ReactNode }) {
  const session = useEditingSession()
  return React.createElement(EditingSessionContext.Provider, { value: session }, children)
}

/**
 * The app-wide session, or a private one when no provider is mounted.
 *
 * The fallback is deliberate: the task detail's ~40 existing `editingX` call
 * sites and their tests keep working without every one of them being wrapped.
 * A component rendered outside a provider still gets correct single-editor
 * behaviour locally — it just does not participate in the app-wide hand-off.
 *
 * The local session is always constructed because hooks cannot be conditional.
 * An unused one costs a pair of idle listeners and commits nothing, since it
 * never has an active editor.
 */
export function useSharedEditingSession(): EditingSession {
  const shared = useContext(EditingSessionContext)
  const local = useEditingSession()
  return shared ?? local
}
