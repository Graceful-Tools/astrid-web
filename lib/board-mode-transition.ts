export interface BoardModeTransition {
  prevTaskViewMode: 'list' | 'board'
  nextTaskViewMode: 'list' | 'board'
}

/**
 * True only when `taskViewMode` just transitioned from 'list' → 'board'.
 *
 * Bug history (task a1e5c0ff follow-up): the previous effect fired the
 * "leave chat / close task detail" side-effects whenever `taskViewMode`
 * happened to equal 'board' on a render. While the user was in board view,
 * any other state change (e.g. tapping the Messages segment to flip
 * `activePanel` to 'chat') would re-render the component and the effect
 * would slam `activePanel` back to 'tasks', making Messages appear broken.
 *
 * We only want to clear the chat panel and close the task detail at the
 * moment of entry, not for the duration of the stay.
 */
export function didEnterBoardMode({ prevTaskViewMode, nextTaskViewMode }: BoardModeTransition): boolean {
  return nextTaskViewMode === 'board' && prevTaskViewMode !== 'board'
}
