/**
 * One editing session at a time (task 7b60c7c5, companion to iOS/Mac 55010e29).
 *
 * The problem this exists to remove: a dozen-plus editors, each with its own
 * `isEditing` flag and its own save semantics. The task detail alone holds
 * eight independent booleans and nothing stops two being true at once — so you
 * can edit a list and tap the title and have both open. Every local fix for
 * that ("close the keyboard before opening the picker") was one instance of a
 * rule nobody had written down.
 *
 * So write it down, once:
 *
 *   begin(B)  COMMITS and closes whatever was active, then activates B
 *   end(A)    commits A
 *   cancel(A) reverts A — the only transition that reverts
 *
 * UNIVERSAL POLICY: **commit on resign.** Tapping outside, opening another
 * editor, navigating away and backgrounding all SAVE. Only an explicit Cancel
 * reverts. One rule to learn, one rule to test.
 *
 * Because `begin` closes the previous editor by construction, mutual exclusion
 * is a property of this machine rather than something each call site has to
 * remember. That is the whole point — two paths for one decision are how the
 * original regression happened.
 *
 * Pure: no React, no DOM, no side effects. The caller performs the commit or
 * cancel that a transition reports.
 */

export type EditorId = string

export interface EditingSessionState {
  readonly activeEditor: EditorId | null
}

export interface EditingTransition {
  /** The session after the transition. */
  state: EditingSessionState
  /** Editor whose pending edit the caller must COMMIT, if any. */
  commit: EditorId | null
  /** Editor whose pending edit the caller must REVERT, if any. */
  cancel: EditorId | null
}

/** No editor open. */
export const IDLE: EditingSessionState = { activeEditor: null }

function transition(
  activeEditor: EditorId | null,
  commit: EditorId | null = null,
  cancelled: EditorId | null = null,
): EditingTransition {
  return { state: { activeEditor }, commit, cancel: cancelled }
}

/**
 * Open `id`, committing and closing whatever was active.
 *
 * Re-opening the already-active editor is a no-op rather than a commit — a
 * component re-rendering must not silently save on its own behalf.
 */
export function begin(state: EditingSessionState, id: EditorId): EditingTransition {
  if (state.activeEditor === id) return transition(id)
  return transition(id, state.activeEditor)
}

/**
 * Commit `id` and close the session.
 *
 * A stale `end` — one from an editor that `begin` already handed off — is
 * ignored. Honouring it would write the old editor's value over the new one's,
 * and blur events routinely arrive after the hand-off.
 */
export function end(state: EditingSessionState, id: EditorId): EditingTransition {
  if (state.activeEditor !== id) return transition(state.activeEditor)
  return transition(null, id)
}

/** Revert `id` and close the session. Stale cancels are ignored, as with {@link end}. */
export function cancel(state: EditingSessionState, id: EditorId): EditingTransition {
  if (state.activeEditor !== id) return transition(state.activeEditor)
  return transition(null, null, id)
}

/**
 * Close the session, committing whatever was open.
 *
 * This is "navigating away and backgrounding SAVE" — the policy applied to the
 * events that aren't a specific editor's business.
 */
export function commitAll(state: EditingSessionState): EditingTransition {
  return transition(null, state.activeEditor)
}

/** True when `id` is the one open editor. */
export function isActive(state: EditingSessionState, id: EditorId): boolean {
  return state.activeEditor === id
}
