/**
 * The v1 list wire shape — what `GET /api/v1/lists/:id` returns under `list`.
 *
 * One definition, used by that route, its PUT, and the live list and
 * membership events (AWTD-1046, the list half of AWTD-1040). The events carried
 * a partial list — a raw Prisma row, or only ids and a name — so astrid-core
 * (iOS, Mac, Windows) followed every one with this GET: one extra request per
 * event, per connected client. Carrying the same shape as `v1List` lets the
 * client apply it and skip the fetch, which is only safe if the two are the
 * same shape by construction. They had already drifted: the PUT sent
 * `defaultDueTime` and the GET did not.
 *
 * Unlike a task, the body is PER VIEWER. `isFavorite`/`favoriteOrder` and the
 * sort and filter fields come from the caller's own rows, so an event cannot
 * carry one body for everyone — that is exactly why list_updated used to strip
 * the favorite fields. `loadV1ListsForViewers` builds one per recipient from a
 * single list read plus two batched per-user reads.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { broadcastToUsers } from '@/lib/sse-utils'
import { createLogger } from '@/lib/logger'
import type { V1List, V1UserSummary } from '@/lib/api-contracts/v1-ios-shapes'
import { resolveDefaultAssignees, pickDefaultAssignee } from '@/lib/default-assignee'
import { hasListAccess } from '@/lib/list-member-utils'
import { DEFAULT_LIST_SHOW_SUBTASKS } from '@/lib/list-subtask-visibility'
import { serializeListAgentFields } from '@/lib/resolve-default-agent'
import { overlayListViewPreferences, type ListViewPreferences } from '@/lib/list-view-preferences'

const log = createLogger('lists.v1-list-shape')

const USER_SUMMARY_SELECT = {
  id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true,
} as const

export const V1_LIST_READ_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  listMembers: { include: { user: { select: USER_SUMMARY_SELECT } } },
  listInvites: {
    select: { id: true, listId: true, email: true, role: true, token: true, createdAt: true, createdBy: true },
  },
  _count: { select: { tasks: true } },
} as const

/** A list row read with V1_LIST_READ_INCLUDE, with the viewer's state layered on. */
export type V1ListRow = Prisma.TaskListGetPayload<{ include: typeof V1_LIST_READ_INCLUDE }> & {
  isFavorite?: boolean
  favoriteOrder?: number | null
}

/**
 * Shape a row for the wire. The row must already carry the viewer's favorite
 * and view preferences; `defaultAssignees` is from resolveDefaultAssignees.
 */
export function shapeV1List(list: V1ListRow, defaultAssignees: Map<string, unknown>): V1List {
  return {
    id: list.id,
    name: list.name,
    description: list.description || '',
    color: list.color || DEFAULT_LIST_COLOR,
    imageUrl: list.imageUrl,
    privacy: list.privacy,
    isFavorite: list.isFavorite ?? false,
    favoriteOrder: list.favoriteOrder ?? null,
    owner: list.owner as V1UserSummary | null,
    listMembers: list.listMembers,
    invitations: list.listInvites,
    taskCount: list._count.tasks,
    isVirtual: list.isVirtual,
    virtualListType: list.virtualListType,
    sortBy: list.sortBy,
    manualSortOrder: list.manualSortOrder,
    filterPriority: list.filterPriority,
    filterAssignee: list.filterAssignee,
    filterDueDate: list.filterDueDate,
    filterCompletion: list.filterCompletion,
    filterRepeating: list.filterRepeating,
    filterAssignedBy: list.filterAssignedBy,
    filterInLists: list.filterInLists,
    defaultPriority: list.defaultPriority,
    defaultRepeating: list.defaultRepeating,
    ownerId: list.ownerId,
    defaultAssigneeId: list.defaultAssigneeId,
    // Same parity gap as the collection route (task dc143ab2): this
    // projection dropped fields the web reads, and a missing field here
    // is a feature silently switched off rather than an error.
    defaultAssignee: pickDefaultAssignee(list.defaultAssigneeId, defaultAssignees) as V1UserSummary | null,
    ...serializeListAgentFields(list.aiAgentsEnabled),
    publicListType: list.publicListType ?? null,
    defaultIsPrivate: list.defaultIsPrivate,
    defaultDueDate: list.defaultDueDate,
    defaultDueTime: list.defaultDueTime,
    githubRepositoryId: list.githubRepositoryId,
    preferredAiProvider: list.preferredAiProvider,
    projectId: list.projectId ?? null,
    listType: (list.listType ?? 'regular') as V1List['listType'],
    recentlyCompletedWindow: list.recentlyCompletedWindow ?? null,
    showSubtasks: list.showSubtasks ?? DEFAULT_LIST_SHOW_SUBTASKS,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  }
}

/** Who may read a list through the v1 GET: owner, members, or anyone if public. */
function canView(list: V1ListRow, userId: string): boolean {
  return list.privacy === 'PUBLIC' || hasListAccess(list as never, userId)
}

/**
 * The v1 list as each of `userIds` would GET it. Users who cannot see the list
 * are absent from the map — they must get the lean event, never the roster and
 * invitations. An empty map means the list is gone or the read failed; either
 * way the event goes out lean and the client fetches, exactly as before.
 */
export async function loadV1ListsForViewers(
  listId: string,
  userIds: string[],
): Promise<Map<string, V1List>> {
  const result = new Map<string, V1List>()
  try {
    const list = await prisma.taskList.findUnique({ where: { id: listId }, include: V1_LIST_READ_INCLUDE })
    if (!list) return result

    const viewers = [...new Set(userIds)].filter(id => canView(list, id))
    if (viewers.length === 0) return result

    const [favorites, preferences, defaultAssignees] = await Promise.all([
      prisma.userListFavorite?.findMany({
        where: { listId, userId: { in: viewers } },
        select: { userId: true, favoriteOrder: true },
      }) ?? [],
      prisma.userListViewPreference?.findMany({
        where: { listId, userId: { in: viewers } },
      }) ?? [],
      resolveDefaultAssignees([list]),
    ])
    const favoriteOrderByUser = new Map((favorites ?? []).map(f => [f.userId, f.favoriteOrder]))
    const preferencesByUser = new Map((preferences ?? []).map(p => [p.userId, p as ListViewPreferences]))

    for (const userId of viewers) {
      const row: V1ListRow = { ...list }
      row.isFavorite = favoriteOrderByUser.has(userId)
      row.favoriteOrder = favoriteOrderByUser.get(userId) ?? null
      overlayListViewPreferences(row, preferencesByUser.get(userId))
      result.set(userId, shapeV1List(row, defaultAssignees))
    }
  } catch (err) {
    log.error({ err, listId }, 'Failed to load the v1 list for a list event')
    result.clear()
  }
  return result
}

/**
 * Broadcast a list or membership event, adding `v1List` for each recipient
 * who can see the list. Everyone else gets `data` unchanged.
 *
 * One broadcast per viewer because the body differs per viewer; recipients
 * without one share a single lean broadcast.
 */
export async function broadcastListEvent(args: {
  listId: string
  recipients: string[]
  type: string
  data: Record<string, unknown>
  timestamp?: string
}): Promise<void> {
  const { listId, type, data } = args
  const recipients = [...new Set(args.recipients)].filter(Boolean)
  if (recipients.length === 0) return

  const timestamp = args.timestamp ?? new Date().toISOString()
  const v1Lists = await loadV1ListsForViewers(listId, recipients)

  const lean = recipients.filter(id => !v1Lists.has(id))
  await Promise.all([
    ...[...v1Lists].map(([userId, v1List]) =>
      broadcastToUsers([userId], { type, timestamp, data: { ...data, v1List } })
    ),
    ...(lean.length > 0 ? [broadcastToUsers(lean, { type, timestamp, data })] : []),
  ])
}
