/**
 * The replica read for a page of GitHub project items (AWTD-1297), split out
 * of services/github-projects.service.ts, the replica writer that uses it.
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §13.3 — ≤ 4 queries per item
 * event. Each to-many relation in a Prisma `select` is a statement of its own,
 * and three of them ran on every item event whether the task held anything or
 * not. So what a task holds is COUNTED in the replica read (one statement) and
 * read only for the tasks that hold some. Pinned by
 * tests/services/github-projects-apply-query-budget.test.ts.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GITHUB_MIRRORED_LIST } from '@/lib/backends/github-labels'

const REPLICA_SELECT = {
  id: true,
  remoteNodeId: true,
  title: true,
  description: true,
  completed: true,
  closedReason: true,
  statusRole: true,
  priority: true,
  dueDateTime: true,
  isAllDay: true,
  identifier: true,
  remoteKind: true,
  remoteVersion: true,
  // Relationships (AWTD-1119). A to-one read costs a statement only when the
  // key is set, so these ride along.
  parentTaskId: true,
  parentTask: { select: { remoteNodeId: true } },
  // Assignees (AWTD-1190). An agent is never GitHub's to unassign.
  assigneeId: true,
  assigneeIds: true,
  assignee: { select: { isAIAgent: true } },
} as const

/** Only MIRRORED blockers are read back: a blocker on a local Astrid task is never GitHub's to remove. */
const MIRRORED_BLOCKER = { blockingTask: { remoteNodeId: { not: null } } }

/** The replica read: what a task holds is counted, not read. Field values are counted per board. */
const replicaSelect = (projectId: string) =>
  ({
    ...REPLICA_SELECT,
    _count: {
      select: {
        blockedBy: { where: MIRRORED_BLOCKER },
        lists: { where: GITHUB_MIRRORED_LIST },
        fieldValues: { where: { projectId } },
      },
    },
  }) as const

/**
 * What a task holds that GitHub mirrors, for the tasks that hold any.
 * Blockers (AWTD-1119); labels (AWTD-1188), milestones (AWTD-1189) and
 * iterations (AWTD-1230). Only lists that MIRROR GitHub are read back: a label
 * a person gave the task in Astrid is never GitHub's to remove. One read covers
 * every flavor; each apply pass filters to its own by `listType`.
 */
const HELD_SELECT = {
  blockedBy: { where: MIRRORED_BLOCKER, select: { blockingTaskId: true } },
  lists: { where: GITHUB_MIRRORED_LIST, select: { id: true, remoteNodeId: true, listType: true } },
} as const

type Held = Prisma.TaskGetPayload<{ select: typeof HELD_SELECT }>

export type ReplicaRow = Prisma.TaskGetPayload<{ select: typeof REPLICA_SELECT }> & Held & { holdsFieldValues: boolean }

/** The page's replicas, reading what they hold only where they hold something. */
export async function readReplicas(projectId: string, contentIds: string[]): Promise<ReplicaRow[]> {
  if (contentIds.length === 0) return []
  const rows = await prisma.task.findMany({ where: { remoteNodeId: { in: contentIds } }, select: replicaSelect(projectId) })
  const withBlockers = rows.filter(row => row._count.blockedBy > 0).map(row => row.id)
  const withLists = rows.filter(row => row._count.lists > 0).map(row => row.id)
  const held =
    withBlockers.length + withLists.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: [...new Set([...withBlockers, ...withLists])] } },
          select: {
            id: true,
            ...(withBlockers.length > 0 ? { blockedBy: HELD_SELECT.blockedBy } : {}),
            ...(withLists.length > 0 ? { lists: HELD_SELECT.lists } : {}),
          },
        })
      : []
  const heldById = new Map(held.map(row => [row.id, row as Partial<Held>]))
  return rows.map(({ _count, ...row }) => ({
    ...row,
    blockedBy: heldById.get(row.id)?.blockedBy ?? [],
    lists: heldById.get(row.id)?.lists ?? [],
    holdsFieldValues: _count.fieldValues > 0,
  }))
}
