/**
 * The decisions behind the one add-task control (task f699462a).
 *
 * The control renders in two placements — pinned to the bottom of the 1-column
 * view, and in the flow above the list in 2- and 3-column. Everything that
 * differs between those placements is decided here, as pure functions, so the
 * component stays a rendering concern and the rules are testable without a DOM.
 *
 * The hashtag helpers came from enhanced-task-creation.tsx, the separate desktop
 * input this task retired. Its `#list` autocomplete moved here so the merged
 * control kept it — and so the 1-column placement gained it.
 */

import type { TaskList } from '@/types/task'

export type QuickAddPlacement = 'inline' | 'fixed-bottom'
export type LayoutType = '1-column' | '2-column' | '3-column'

/**
 * Width at which the create button has room for its label. Below this the
 * button is the icon-only square the 1-column bar uses; at or above it the
 * words fit without squeezing the textarea.
 */
export const ADD_TASK_LABEL_MIN_WIDTH = 420

/**
 * `containerWidth` is null until the control has been measured. Assuming "wide"
 * before then makes the label appear and then vanish on the next frame in a
 * narrow column, so an unmeasured control stays icon-only.
 */
export function shouldShowAddTaskLabel(
  placement: QuickAddPlacement,
  containerWidth: number | null,
): boolean {
  if (placement !== 'inline') return false
  if (containerWidth === null) return false
  return containerWidth >= ADD_TASK_LABEL_MIN_WIDTH
}

export interface HashtagQuery {
  /** Lower-cased text typed after the `#`, empty for a bare `#`. */
  query: string
  /** Index of the `#` itself, so a selection can replace from there. */
  start: number
}

/**
 * Only a hashtag still being typed — one running to the end of the value —
 * opens the dropdown. A finished `#groceries` earlier in the title must not
 * re-open it every time a later word is typed.
 */
export function findHashtagQuery(value: string): HashtagQuery | null {
  const match = value.match(/#([^\s]*)$/)
  if (!match) return null
  return { query: match[1].toLowerCase(), start: match.index! }
}

const dashed = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

export function filterListsForHashtag(
  lists: TaskList[],
  query: string,
  limit = 5,
): TaskList[] {
  const needle = query.toLowerCase()
  return lists
    // A virtual list ("Today", "Assigned") is a view, not somewhere a task lands.
    .filter(list => !list.isVirtual)
    .filter(list => {
      const name = list.name.toLowerCase()
      return (
        name.includes(needle) ||
        name.replace(/\s+/g, '-').includes(needle) ||
        name.replace(/\s+/g, '_').includes(needle)
      )
    })
    .slice(0, limit)
}

/** Swaps the fragment being typed for the list's `#dashed-tag`, plus a space. */
export function applyHashtagSelection(value: string, listName: string): string {
  const match = findHashtagQuery(value)
  if (!match) return value
  return `${value.substring(0, match.start)}#${dashed(listName)} `
}

export interface QuickAddPlaceholder {
  key: string
  params?: Record<string, string>
}

/**
 * Placement and layout pick the prompt; the caller resolves the key so this
 * stays free of the i18n runtime. 3-column names the list because several
 * lists are on screen at once and the input alone would be ambiguous.
 */
export function quickAddPlaceholder({
  placement,
  layoutType,
  listName,
}: {
  placement: QuickAddPlacement
  layoutType?: LayoutType
  listName?: string
}): QuickAddPlaceholder {
  if (placement === 'fixed-bottom') return { key: 'tasks.addTaskPlaceholder' }

  switch (layoutType) {
    case '3-column':
      return listName && listName !== 'My Tasks'
        ? { key: 'tasks.addTaskToList', params: { listName } }
        : { key: 'tasks.addTaskToCurrentList' }
    case '2-column':
      return { key: 'tasks.addTaskShort' }
    default:
      return { key: 'tasks.addNewTask' }
  }
}
