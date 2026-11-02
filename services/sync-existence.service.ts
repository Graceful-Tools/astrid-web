/**
 * Which of these ids may the caller still read? — the query half of
 * `POST /api/v1/sync/existence` (AWTD-1515).
 *
 * One query per kind, each with the same access clause its per-row GET uses
 * (`taskReadAccessWhere` for `GET /api/v1/tasks/:id`, `listReadByIdWhere` for
 * `GET /api/v1/lists/:id`), so "missing here" and "403/404 there" cannot
 * drift apart. The request parsing and response shape are pure and live in
 * lib/sync/v1-existence.ts, where the contract-fixture driver runs them.
 */
import { prisma } from '@/lib/prisma'
import { taskReadAccessWhere } from '@/lib/api-auth-middleware'
import { listReadByIdWhere } from '@/lib/list-permissions'

export async function findReadableIds(
  userId: string,
  ids: { taskIds: string[]; listIds: string[] }
): Promise<{ taskIds: string[]; listIds: string[] }> {
  const [tasks, lists] = await Promise.all([
    ids.taskIds.length > 0
      ? prisma.task.findMany({
          where: { id: { in: ids.taskIds }, ...taskReadAccessWhere(userId) },
          select: { id: true },
        })
      : [],
    ids.listIds.length > 0
      ? prisma.taskList.findMany({
          where: { id: { in: ids.listIds }, ...listReadByIdWhere(userId) },
          select: { id: true },
        })
      : [],
  ])
  return { taskIds: tasks.map(t => t.id), listIds: lists.map(l => l.id) }
}
