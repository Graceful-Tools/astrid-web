/**
 * Iteration values → iteration lists (AWTD-1230, P6c-3b).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4, §9.4. Runs after P6a's
 * `applyFieldValues` on every hydrated page, and reads what it stored rather
 * than the item — see lib/github/projects/iterations.ts for why. Shaped like
 * `applyMilestones` (services/github-projects.service.ts): one list per
 * (field, iteration), created on first sight, renamed or re-dated as GitHub
 * changes it, and a task carries the iteration by being on it.
 *
 * Cost per page: one read of the board's iteration fields; when there are any,
 * one read of the page's iteration values and one of their lists, plus two
 * more when an iteration is new.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'
import { LIST_TYPE_ITERATION } from '@/lib/list-flavors'
import {
  ITERATION_LIST_COLOR,
  isEmptyIterationPlan,
  iterationListDescription,
  iterationListDrift,
  planIterations,
  wantedIterations,
  type IterationField,
  type WantedIteration,
} from '@/lib/github/projects/iterations'

const log = createLogger('services.github-iteration-lists')

const ITERATION_LIST_SELECT = { id: true, remoteNodeId: true, name: true, description: true } as const

export interface IterationBoard {
  projectId: string
  ownerId: string
}

export interface IterationTask {
  taskId: string
  /** The iteration lists the task is on now. */
  held: ReadonlyArray<{ id: string; remoteNodeId: string | null }>
}

/** Answers whether anything was written. */
export async function applyIterationLists(board: IterationBoard, tasks: readonly IterationTask[]): Promise<boolean> {
  if (tasks.length === 0) return false

  const fieldRows = await prisma.projectField.findMany({
    where: { projectId: board.projectId, dataType: 'iteration', mappedTo: null },
    select: { id: true, remoteId: true, name: true, iterations: true },
  })
  const fields = new Map(fieldRows.map(row => [row.id, row as unknown as IterationField]))
  if (fields.size === 0 && tasks.every(task => task.held.length === 0)) return false

  const values =
    fields.size > 0
      ? await prisma.taskFieldValue.findMany({
          where: { taskId: { in: tasks.map(task => task.taskId) }, fieldId: { in: [...fields.keys()] } },
          select: { taskId: true, fieldId: true, iterationId: true },
        })
      : []

  const wantedByTask = new Map<string, WantedIteration[]>()
  const seen = new Map<string, WantedIteration>()
  for (const task of tasks) {
    const wanted = wantedIterations(values.filter(value => value.taskId === task.taskId), fields)
    wantedByTask.set(task.taskId, wanted)
    for (const entry of wanted) seen.set(entry.key, entry)
  }

  const writes: Prisma.PrismaPromise<unknown>[] = []
  const listIds = new Map<string, string>()
  if (seen.size > 0) {
    const known = await prisma.taskList.findMany({ where: { remoteNodeId: { in: [...seen.keys()] } }, select: ITERATION_LIST_SELECT })
    for (const list of known) {
      listIds.set(list.remoteNodeId as string, list.id)
      const { field, iteration } = seen.get(list.remoteNodeId as string)!
      const drift = iterationListDrift(field.name, iteration, list)
      if (drift) writes.push(prisma.taskList.update({ where: { id: list.id }, data: drift }))
    }

    const fresh = [...seen.values()].filter(entry => !listIds.has(entry.key))
    if (fresh.length > 0) {
      await prisma.taskList.createMany({
        data: fresh.map(({ key, field, iteration }) => ({
          name: iteration.title,
          color: ITERATION_LIST_COLOR,
          description: iterationListDescription(field.name, iteration),
          ownerId: board.ownerId,
          listType: LIST_TYPE_ITERATION,
          remoteNodeId: key,
        })),
        // Another job may have met the same iteration: the key is unique.
        skipDuplicates: true,
      })
      const made = await prisma.taskList.findMany({
        where: { remoteNodeId: { in: fresh.map(entry => entry.key) } },
        select: ITERATION_LIST_SELECT,
      })
      for (const list of made) listIds.set(list.remoteNodeId as string, list.id)
      await RedisCache.invalidate.userLists(board.ownerId).catch(err => {
        log.warn({ err, projectId: board.projectId }, 'Failed to clear the board owner’s list cache')
      })
    }
  }

  for (const { taskId, held } of tasks) {
    const plan = planIterations(
      (wantedByTask.get(taskId) ?? []).map(entry => entry.key),
      held.map(list => list.remoteNodeId as string),
    )
    if (isEmptyIterationPlan(plan)) continue
    const connect = plan.join.flatMap(key => (listIds.has(key) ? [{ id: listIds.get(key)! }] : []))
    const leaving = new Set(plan.leave)
    const disconnect = held.filter(list => leaving.has(list.remoteNodeId as string)).map(list => ({ id: list.id }))
    if (connect.length === 0 && disconnect.length === 0) continue
    writes.push(
      prisma.task.update({
        where: { id: taskId },
        data: { lists: { ...(connect.length > 0 ? { connect } : {}), ...(disconnect.length > 0 ? { disconnect } : {}) } },
      }),
    )
  }

  if (writes.length > 0) await prisma.$transaction(writes)
  return writes.length > 0
}
