export type HeaderToggleSegment = 'list' | 'board' | 'messages'

export interface HeaderViewToggleState {
  /** True when the layout is a 1-column mobile layout. */
  isOneColumn: boolean
  /** True when the selected list has a project status board attached. */
  hasProjectBoard: boolean
  /** True when the chat panel is wired (caller has a `onToggleActivePanel`). */
  chatAvailable: boolean
  /** Current top-level view. */
  activeView: 'list' | 'settings' | 'search'
  /** True when a search input is active (mobile search mode or non-empty query). */
  isSearching: boolean
}

export interface HeaderViewToggleConfig {
  segments: HeaderToggleSegment[]
  /**
   * `true`  → render a single unified segmented control containing all
   *           segments (1-col mode).
   * `false` → render the legacy split layout: List/Board as a segmented
   *           control, Messages as a separate ChatToggle icon. The
   *           Messages segment is intentionally omitted from `segments`
   *           when `unified` is false because the legacy ChatToggle
   *           handles it.
   */
  unified: boolean
}

/**
 * Decide which segments the header's view-toggle should render and how.
 *
 * Task a1e5c0ff: in 1-column mobile, List / Board / Messages should be a
 * single 3-way segmented control (same visual style as the old List/Board
 * toggle), instead of a List/Board toggle next to a separate Messages icon.
 * Wider screens keep the current split layout to preserve density.
 */
export function getHeaderViewToggle(state: HeaderViewToggleState): HeaderViewToggleConfig {
  if (state.activeView !== 'list' || state.isSearching) {
    return { segments: [], unified: false }
  }

  const segments: HeaderToggleSegment[] = ['list']
  if (state.hasProjectBoard) segments.push('board')

  if (state.isOneColumn) {
    if (state.chatAvailable) segments.push('messages')
    // 1-col with no board and no chat = single segment, not useful as a toggle.
    if (segments.length <= 1) return { segments: [], unified: false }
    return { segments, unified: true }
  }

  // Wider layout: legacy split — Messages rendered separately by caller.
  return { segments, unified: false }
}
