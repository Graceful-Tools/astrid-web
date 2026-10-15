/**
 * List flavors — the one primitive doing several jobs (task 60f5849d).
 *
 * `TaskList.listType` already carried `regular | status`. Labels become a third
 * flavor rather than a new entity, because **multi-list membership already is
 * labels**: a task in "iOS To-do" + "Bugs" is exactly a task with a label. The
 * model was right; only the presentation was missing.
 *
 * What a label list is NOT: it carries no `sortBy`, no defaults, no chat
 * channel and no agent config. A label is a tag, and the UI must not imply
 * otherwise by offering it as a destination.
 *
 * Because a label is still a list, **filtering comes free** — `filterInLists`
 * on virtual lists already filters by list membership, so "all Bugs across
 * every project" works the day this ships, with no new filter field.
 */

import type { TaskList } from '@/types/task'

export const LIST_TYPE_REGULAR = 'regular'
export const LIST_TYPE_STATUS = 'status'
export const LIST_TYPE_LABEL = 'label'
/**
 * A GitHub milestone (AWTD-1189). A fourth flavor for the same reason labels
 * were a third: a milestone is a tag a task carries, and membership already
 * expresses that. The difference is arity — a task has at most ONE milestone,
 * which `planMilestone` enforces, not this module.
 */
export const LIST_TYPE_MILESTONE = 'milestone'

export type ListFlavor =
  | typeof LIST_TYPE_REGULAR
  | typeof LIST_TYPE_STATUS
  | typeof LIST_TYPE_LABEL
  | typeof LIST_TYPE_MILESTONE

type ListLike = Pick<TaskList, 'listType'> | { listType?: string | null } | null | undefined

/** A label: renders as a chip, never as a destination. */
export function isLabelList(list: ListLike): boolean {
  return list?.listType === LIST_TYPE_LABEL
}

/** A GitHub milestone: renders as a chip, never as a destination (AWTD-1189). */
export function isMilestoneList(list: ListLike): boolean {
  return list?.listType === LIST_TYPE_MILESTONE
}

/**
 * A tag rather than a place: a label or a milestone.
 *
 * The distinction every chip-or-destination decision actually wants. Call this
 * instead of testing the two flavors at each site — adding the milestone flavor
 * meant finding every `isLabelList` that had really meant "is a tag", and a
 * fifth flavor should not mean doing that again.
 */
export function isTagList(list: ListLike): boolean {
  return isLabelList(list) || isMilestoneList(list)
}

/** A board column. */
export function isStatusList(list: ListLike): boolean {
  return list?.listType === LIST_TYPE_STATUS
}

/**
 * A real list — somewhere tasks live, and a place you can navigate to.
 *
 * Treats a missing `listType` as regular: every row predating flavors is a
 * domain list, and defaulting the other way would hide them all.
 */
export function isDomainList(list: ListLike): boolean {
  return !isTagList(list) && !isStatusList(list)
}

/**
 * Lists that belong in list-shaped surfaces: the sidebar tree, the
 * move-to-list picker, list counts.
 *
 * The canonical filter — call this rather than writing `listType !== 'label'`
 * at each call site, or the next flavor has to be added in a dozen places.
 */
export function filterDomainLists<T extends ListLike>(lists: T[]): T[] {
  return lists.filter(isDomainList)
}

export function filterLabelLists<T extends ListLike>(lists: T[]): T[] {
  return lists.filter(isLabelList)
}

/** The tag memberships — labels and milestones — a surface renders as chips. */
export function filterTagLists<T extends ListLike>(lists: T[]): T[] {
  return lists.filter(isTagList)
}

/**
 * Split a task's memberships for rendering: the lists it lives in, and the
 * labels it carries. Status memberships belong to neither — the board renders
 * those as columns, and repeating them as chips on the row is noise.
 */
export function splitTaskLists<T extends ListLike>(lists: T[] | undefined | null): {
  lists: T[]
  labels: T[]
} {
  const all = lists ?? []
  return {
    lists: all.filter(isDomainList),
    labels: all.filter(isTagList),
  }
}

/**
 * The memberships a task row shows as chips while `currentListId` is being
 * viewed (AWTD-1025): all of them except that one. Inside a list, every row
 * would carry the same chip, which says nothing. A virtual view ("my-tasks",
 * "today") matches no membership, so it hides nothing.
 */
export function listsShownOnRow<T extends { id: string }>(
  lists: T[] | undefined | null,
  currentListId: string | null | undefined,
): T[] {
  return (lists ?? []).filter(list => list.id !== currentListId)
}

/**
 * Is this a flavor change we allow?
 *
 * Regular ⇄ label is a supported admin action and preserves memberships (the
 * membership rows are identical; only the rendering differs). Converting to or
 * from `status` is not offered: status lists are board machinery with
 * invariants (at most one per task) that a conversion would silently violate.
 */
export function canConvertListFlavor(from: string | null | undefined, to: string): boolean {
  const convertible = new Set([LIST_TYPE_REGULAR, LIST_TYPE_LABEL])
  const normalizedFrom = from || LIST_TYPE_REGULAR
  return convertible.has(normalizedFrom) && convertible.has(to) && normalizedFrom !== to
}

/**
 * Map GitHub issue labels onto label-list names.
 *
 * `ExternalTaskLink.metadata.labels` has carried these through sync all along
 * with nowhere to put them; this is that home. Names are trimmed and
 * de-duplicated case-insensitively, because GitHub treats "Bug" and "bug" as
 * distinct labels but users do not.
 */
export function parseGithubLabels(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of raw.split(',')) {
    const name = part.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/**
 * Match GitHub label names to existing label lists, and report which are
 * missing so the caller can create them.
 *
 * Matching is case-insensitive for the same reason as above.
 */
export function reconcileGithubLabels(
  githubLabels: string[],
  existing: Array<{ id: string; name: string }>
): { matchedListIds: string[]; missingNames: string[] } {
  const byName = new Map(existing.map(list => [list.name.trim().toLowerCase(), list.id]))
  const matchedListIds: string[] = []
  const missingNames: string[] = []

  for (const label of githubLabels) {
    const match = byName.get(label.trim().toLowerCase())
    if (match) matchedListIds.push(match)
    else missingNames.push(label)
  }

  return { matchedListIds, missingNames }
}

/**
 * How many characters of a tag's name a task row shows (AWTD-1206).
 *
 * A list name is a title, not a label, and a long one turns a row's tag strip
 * into a wall. Twelve is what Jon asked for.
 */
export const CHIP_LABEL_MAX = 12

/**
 * A tag's name as a task row shows it: at most `max` characters, with an
 * ellipsis when it was cut.
 *
 * Cut by CHARACTERS rather than by CSS `truncate`, which ellipsises on
 * available width — so the same list reads differently in a narrow column than
 * a wide one, and two tags of the same name can disagree on the same screen.
 * A character cap is the same everywhere and is what makes the strip uniform.
 *
 * The cut is trimmed, so a name whose 13th character is a space does not
 * render as "Hello world …" with a gap before the ellipsis.
 *
 * This is only the TEXT. "Never wrap" is `whitespace-nowrap` on the span, and
 * the chips reflowing onto the next line is the container's `flex-wrap`;
 * neither belongs here.
 */
export function chipLabelText(name: string | null | undefined, max: number = CHIP_LABEL_MAX): string {
  const value = name ?? ''
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}
