/**
 * Server side of the multi-list project board's row choice (AWTD-1660): which
 * lists one person's board for one project shows, saved in `ProjectBoardView`
 * so it follows them across devices.
 *
 * Who may read or save it is decided by rules that already exist:
 *   - the project: its owner or a member (`authorizeProjectAttach`), the same
 *     people `GET /api/v1/projects` lists it for;
 *   - each list: one the person can see (`listVisibilityWhere`), so a board can
 *     never become a way to read a list they are not on.
 * The route runs `projectModeGate` before either.
 */
import { prisma } from '@/lib/prisma'
import { listVisibilityWhere } from '@/lib/list-permissions'
import { authorizeProjectAttach } from '@/lib/projects-service'
import { PROJECT_BOARD_MAX_ROWS } from '@/lib/project-board-rows'

export type BoardViewRefusal =
  | { error: 'not_found' }
  | { error: 'forbidden' }
  | { error: 'unreadable'; listIds: string[] }

/** Of `listIds`, the ones this person can see, in the order asked. */
async function visibleListIds(userId: string, listIds: string[]): Promise<string[]> {
  if (listIds.length === 0) return []
  const rows = await prisma.taskList.findMany({
    where: { AND: [{ id: { in: listIds } }, listVisibilityWhere(userId, { includePublic: false })] },
    select: { id: true },
  })
  const visible = new Set(rows.map(row => row.id))
  return listIds.filter(id => visible.has(id))
}

/**
 * The saved rows, minus any list the person can no longer see. `null` when
 * nothing has been saved, which the client draws as the project's own lists.
 */
export async function readProjectBoardRows(
  userId: string,
  projectId: string,
): Promise<BoardViewRefusal | { listIds: string[] | null }> {
  const access = await authorizeProjectAttach(projectId, userId)
  if ('error' in access) return access

  const saved = await prisma.projectBoardView.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { listIds: true },
  })
  if (!saved) return { listIds: null }
  return { listIds: await visibleListIds(userId, saved.listIds) }
}

/**
 * Validate a request body's `listIds`: an array of at most
 * PROJECT_BOARD_MAX_ROWS non-empty strings, de-duplicated in order. Null when
 * it is not that.
 */
export function parseBoardRowListIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > PROJECT_BOARD_MAX_ROWS) return null
  if (!value.every(id => typeof id === 'string' && id.length > 0)) return null
  return Array.from(new Set(value as string[]))
}

/** Save the rows. Refuses the whole write if any list is not visible to the person. */
export async function saveProjectBoardRows(
  userId: string,
  projectId: string,
  listIds: string[],
): Promise<BoardViewRefusal | { listIds: string[] }> {
  const access = await authorizeProjectAttach(projectId, userId)
  if ('error' in access) return access

  const visible = new Set(await visibleListIds(userId, listIds))
  const unreadable = listIds.filter(id => !visible.has(id))
  if (unreadable.length > 0) return { error: 'unreadable', listIds: unreadable }

  const saved = await prisma.projectBoardView.upsert({
    where: { userId_projectId: { userId, projectId } },
    create: { userId, projectId, listIds },
    update: { listIds },
    select: { listIds: true },
  })
  return { listIds: saved.listIds }
}
