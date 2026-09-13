/**
 * Per-user list VIEW state — the sort you chose and the filters you applied.
 *
 * Sort and filters were columns on the shared `TaskList` row, so changing a
 * filter on a shared list changed it for every member, on all three platforms.
 * The web UI presents them in a "Sort & Filters" tab next to "Membership" and
 * "Admin Settings" — the two that obviously affect everyone — so the natural
 * reading was that this one is your own view. It wasn't. Two people on one
 * shared list quietly fought over a filter and neither could tell why.
 * (Task aa4e7eb0. Jon, 2026-09-13: "THERE SHOULD BE NO SHARED SAVED FILTERS.")
 *
 * **Keyed on `userId`, which is what "AI agents and humans" means here.** An
 * agent is a `User` row, so an agent's saved filter is its own exactly like a
 * person's — there is one mechanism, not a special case per kind of principal.
 *
 * ## The shape of the fix
 *
 * Structured on `lib/favorites.ts`, which is the established precedent for
 * per-user state about a shared list: the shared row is cached, and the
 * per-user part is overlaid *after* the cache read, so one user's view can
 * never be served to another. The field set has its own precedent too —
 * `User.myTasksPreferences` already stores these same fields per-user for the
 * My Tasks view.
 *
 * **The wire contract does not change.** Reads overlay the caller's values onto
 * the list payload; writes route these fields to the caller's own row instead
 * of the shared column. So every client keeps sending and reading the same
 * fields and silently becomes per-user, with no client change and no breaking
 * migration. `lib/virtual-list-utils.ts` needs no change either: it derives a
 * saved filter's contents from `list.filter*` on the payload, which is now the
 * caller's own — that is what makes saved filters per-user.
 *
 * The `TaskList` columns are KEPT as the fallback. They are the list's default
 * view for someone who has never set one, which is why this is additive rather
 * than a migration that has to move data and can strand people on rollback.
 *
 * `manualSortOrder` is deliberately NOT one of these fields. The hand-arranged
 * order is shared — people arrange a shared list together, and
 * lib/list-manual-order.ts broadcasts it to every member — but the decision to
 * sort BY that order is personal. So `sortBy` moved here and the order did not.
 * (Jon, 2026-09-13.)
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('list-view-preferences')

/**
 * The fields that belong to a viewer rather than to the list.
 *
 * `isVirtual` / `virtualListType` are deliberately absent: they say what kind
 * of thing the list is, not how you are looking at it. `showSubtasks` is absent
 * too — it is a display setting rather than a sort or a filter, so it stays
 * shared until someone decides otherwise.
 */
export const LIST_VIEW_PREFERENCE_FIELDS = [
  'sortBy',
  'filterPriority',
  'filterAssignee',
  'filterDueDate',
  'filterCompletion',
  'filterRepeating',
  'filterAssignedBy',
  'filterInLists',
] as const

export type ListViewPreferenceField = (typeof LIST_VIEW_PREFERENCE_FIELDS)[number]

export type ListViewPreferences = Partial<Record<ListViewPreferenceField, string | null>>

/** A list payload carrying the view fields, however it was loaded. */
type ViewPreferenceCarrier = { id: string } & ListViewPreferences

function isViewPreferenceField(key: string): key is ListViewPreferenceField {
  return (LIST_VIEW_PREFERENCE_FIELDS as readonly string[]).includes(key)
}

/**
 * Split a list-update body into the part that belongs to the caller and the
 * part that belongs to the list.
 *
 * Only keys actually PRESENT are returned. Clients round-trip whole list
 * objects, so treating an absent key as "clear it" would have one client's save
 * wipe a filter it never knew about.
 */
export function splitListViewPreferences<T extends Record<string, unknown>>(
  body: T
): { viewPreferences: ListViewPreferences; rest: Record<string, unknown> } {
  const viewPreferences: ListViewPreferences = {}
  const rest: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (isViewPreferenceField(key)) {
      // Normalized to string | null: these are all nullable text columns, and a
      // client sending a number for filterPriority should not widen the type.
      viewPreferences[key] = value === null || value === undefined ? null : String(value)
    } else {
      rest[key] = value
    }
  }

  return { viewPreferences, rest }
}

/**
 * Save the caller's own view state for one list.
 *
 * Upsert on (userId, listId), writing only the fields provided. Invalidates
 * ONLY this user's cached lists — narrower than the shared columns allowed,
 * where changing a filter had to invalidate every member.
 */
export async function saveListViewPreferences(args: {
  userId: string
  listId: string
  preferences: ListViewPreferences
}): Promise<void> {
  const { userId, listId, preferences } = args
  if (Object.keys(preferences).length === 0) return

  await prisma.userListViewPreference?.upsert({
    where: { userId_listId: { userId, listId } },
    create: { userId, listId, ...preferences },
    update: preferences,
  })

  try {
    await RedisCache.invalidate.userListsAllVersions(userId)
  } catch (error) {
    log.error({ err: error, userId }, 'Failed to invalidate user-lists cache')
  }
}

/** Overlay one stored row onto a list payload, leaving absent fields alone. */
function overlay(list: ViewPreferenceCarrier, stored: ListViewPreferences | undefined): void {
  if (!stored) return
  for (const field of LIST_VIEW_PREFERENCE_FIELDS) {
    // `null` in the row is a real value — the user cleared that filter — and
    // must override the list's column. Only `undefined` means "not set", which
    // cannot happen for a column that exists but does for a partial select.
    const value = stored[field]
    if (value !== undefined) {
      list[field] = value
    }
  }
}

/**
 * Overlay the caller's view state onto many lists, in place.
 *
 * Call this AFTER any cache read, exactly as `hydrateListFavorites` is called:
 * the cached payload holds the shared row, and the per-user part is layered on
 * per request. Caching the merged object under a shared key would serve one
 * user's filters to another.
 */
export async function hydrateListViewPreferences<T extends ViewPreferenceCarrier>(
  lists: T[],
  userId: string
): Promise<T[]> {
  if (lists.length === 0) return lists

  // `?.` and the `?? []` fallback mirror lib/favorites.ts, and for the same
  // reason: this sits on the hot list-read path that many tests drive with a
  // partial `prisma` mock. Falling back to the list's own columns is also the
  // right runtime answer — it is exactly the pre-existing behaviour.
  const stored = (await prisma.userListViewPreference?.findMany({
    where: { userId, listId: { in: lists.map(list => list.id) } },
  })) ?? []

  const byListId = new Map(stored.map(row => [row.listId, row as ListViewPreferences]))
  for (const list of lists) {
    overlay(list, byListId.get(list.id))
  }

  return lists
}

/** Single-list form of {@link hydrateListViewPreferences}. */
export async function hydrateSingleListViewPreferences<T extends ViewPreferenceCarrier>(
  list: T,
  userId: string
): Promise<T> {
  const stored = (await prisma.userListViewPreference?.findUnique({
    where: { userId_listId: { userId, listId: list.id } },
  })) ?? null

  overlay(list, (stored ?? undefined) as ListViewPreferences | undefined)
  return list
}
