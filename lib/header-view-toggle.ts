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
   * `true`  → render ONE control covering every segment (1-col mode): a
   *           single icon that steps through them in order.
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
 * Task a1e5c0ff made 1-column List / Board / Messages one control rather than
 * a toggle beside a separate icon; AWTD-1183 turned that control from a 3-way
 * segmented strip into the iPhone's single rotating icon.
 * Wider screens keep the current split layout to preserve density.
 */
export function getHeaderViewToggle(state: HeaderViewToggleState): HeaderViewToggleConfig {
  if (state.activeView !== 'list' || state.isSearching) {
    return { segments: [], unified: false }
  }

  if (state.isOneColumn) {
    // AWTD-1183: one column matches the iPhone app, whose header has a single
    // icon stepping list → messages → board. The segments are in that order.
    const segments: HeaderToggleSegment[] = ['list']
    if (state.chatAvailable) segments.push('messages')
    if (state.hasProjectBoard) segments.push('board')
    // 1-col with no board and no chat = single segment, not useful as a toggle.
    if (segments.length <= 1) return { segments: [], unified: false }
    return { segments, unified: true }
  }

  // Wider layout: legacy split — Messages rendered separately by caller.
  const segments: HeaderToggleSegment[] = ['list']
  if (state.hasProjectBoard) segments.push('board')
  return { segments, unified: false }
}

/**
 * The view one tap of the one-column rotator opens: the segment after
 * `current`, wrapping to the first. A `current` that is not offered (the board
 * was just disabled, say) starts over from the first.
 */
export function nextHeaderSegment(
  segments: HeaderToggleSegment[],
  current: HeaderToggleSegment,
): HeaderToggleSegment {
  return segments[(segments.indexOf(current) + 1) % segments.length]
}
