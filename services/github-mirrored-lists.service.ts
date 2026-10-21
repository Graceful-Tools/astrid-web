/**
 * Labels and milestones as mirrored lists (AWTD-1188, AWTD-1189).
 *
 * Extracted from services/github-projects.service.ts when AWTD-1315 pushed that
 * file past 800 lines, and extracted HERE rather than anywhere else because the
 * third mirrored flavor already lives in its own service next door:
 * services/github-iteration-lists.service.ts. Two of the three living in the
 * orchestrator and one in a service was an accident of the order they were
 * written, not a design.
 *
 * The two passes differ in exactly one way, which is arity: a task carries any
 * number of labels and at most one milestone, so `planMilestone` returns every
 * OTHER milestone list to leave while `planLabels`, being a set, has no such
 * step. Everything else about them is deliberately the same shape, and they are
 * next to each other so that stays true.
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'
import type { Prisma } from '@prisma/client'
import { hasCapability } from '@/lib/brand/capabilities'
import { LIST_TYPE_LABEL, LIST_TYPE_MILESTONE } from '@/lib/list-flavors'
import { resolveHeldLists } from '@/lib/github/projects/held-lists'
import {
  remoteLabels,
  planLabels,
  isEmptyLabelPlan,
  labelListColor,
  labelListDrift,
  type RemoteLabel,
} from '@/lib/github/projects/labels'
import {
  remoteMilestone,
  planMilestone,
  isEmptyMilestonePlan,
  milestoneListDescription,
  milestoneListDrift,
  MILESTONE_LIST_COLOR,
  type RemoteMilestone,
} from '@/lib/github/projects/milestones'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import type { ReplicaRow } from '@/services/github-projects-replica'
import type { BoundBoard } from '@/services/github-projects.service'

const log = createLogger('github.mirrored-lists')

const LABEL_LIST_SELECT = { id: true, remoteNodeId: true, name: true, color: true } as const

/**
 * Labels for one page (AWTD-1188): each GitHub label is a label-flavor list,
 * one per label node, and a task carries the label by being on it. The labels
 * a task holds ride on the page's replica read; the lists cost one read for
 * the page, and two more queries only when a label is new. A list belongs to
 * no project — a repo can feed several boards — and to the owner of the board
 * that met its label first.
 */
export async function applyLabels(
  board: BoundBoard,
  items: RemoteProjectItem[],
  replicas: Map<string, ReplicaRow>,
  created: Map<string, string>,
): Promise<boolean> {
  const labelled = items.flatMap(item => {
    const remote = item.isArchived ? null : remoteLabels(item, { agentLabels: hasCapability('githubAgentLabels') })
    const row = item.content ? replicas.get(item.content.id) : undefined
    const taskId = row?.id ?? (item.content ? created.get(item.content.id) : undefined)
    const held = (row?.lists ?? []).filter(list => list.listType === LIST_TYPE_LABEL)
    return remote && taskId ? [{ remote, taskId, held }] : []
  })

  const seen = new Map<string, RemoteLabel & { repository: string | null }>()
  for (const { remote } of labelled) {
    for (const label of remote.labels) seen.set(label.nodeId, { ...label, repository: remote.repository })
  }

  const writes: Prisma.PrismaPromise<unknown>[] = []
  const listIds = new Map<string, string>()
  if (seen.size > 0) {
    // A label the task already holds needs no lookup: the held row IS the
    // TaskList row, and since AWTD-1315 it carries the name and colour that
    // `labelListDrift` compares. So this reads only the nodes nobody holds —
    // usually none, on an edit that did not touch the labels. A drifted label
    // is still corrected; the check just runs against the row we already have.
    const { resolved, unresolved } = resolveHeldLists(
      seen.keys(),
      labelled.flatMap(({ held }) => held),
      LIST_TYPE_LABEL,
    )
    const known =
      unresolved.length > 0
        ? await prisma.taskList.findMany({ where: { remoteNodeId: { in: unresolved } }, select: LABEL_LIST_SELECT })
        : []
    for (const list of [...resolved.values(), ...known]) {
      listIds.set(list.remoteNodeId as string, list.id)
      const drift = labelListDrift(seen.get(list.remoteNodeId as string)!, list)
      if (drift) writes.push(prisma.taskList.update({ where: { id: list.id }, data: drift }))
    }

    const fresh = [...seen.values()].filter(label => !listIds.has(label.nodeId))
    if (fresh.length > 0) {
      await prisma.taskList.createMany({
        data: fresh.map(label => ({
          name: label.name,
          color: labelListColor(label.color),
          description: label.repository,
          ownerId: board.ownerId,
          listType: LIST_TYPE_LABEL,
          remoteNodeId: label.nodeId,
        })),
        // Another job may have met the same label: the node id is unique.
        skipDuplicates: true,
      })
      const made = await prisma.taskList.findMany({
        where: { remoteNodeId: { in: fresh.map(label => label.nodeId) } },
        select: LABEL_LIST_SELECT,
      })
      for (const list of made) listIds.set(list.remoteNodeId as string, list.id)
      await RedisCache.invalidate.userLists(board.ownerId).catch(err => {
        log.warn({ err, projectId: board.projectId }, 'Failed to clear the board owner’s list cache')
      })
    }
  }

  for (const { remote, taskId, held } of labelled) {
    const plan = planLabels(remote, held.map(list => list.remoteNodeId as string))
    if (isEmptyLabelPlan(plan)) continue
    const connect = plan.join.flatMap(nodeId => (listIds.has(nodeId) ? [{ id: listIds.get(nodeId)! }] : []))
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

const MILESTONE_LIST_SELECT = { id: true, remoteNodeId: true, name: true, description: true } as const

/**
 * Milestones for one page (AWTD-1189): each GitHub milestone is a
 * milestone-flavor list, one list per milestone node, and a task carries the
 * milestone by being on it. Shaped like `applyLabels` above, and deliberately so
 * — the two differ in exactly one way, which is arity.
 *
 * **A task has at most one milestone.** `planMilestone` returns the one list to
 * join and EVERY other milestone list to leave, so an issue moved from v1.2 to
 * v1.3 stops showing v1.2. Labels, being a set, have no such step.
 */
export async function applyMilestones(
  board: BoundBoard,
  items: RemoteProjectItem[],
  replicas: Map<string, ReplicaRow>,
  created: Map<string, string>,
): Promise<boolean> {
  const stated = items.flatMap(item => {
    const remote = item.isArchived ? null : remoteMilestone(item)
    const row = item.content ? replicas.get(item.content.id) : undefined
    const taskId = row?.id ?? (item.content ? created.get(item.content.id) : undefined)
    const held = (row?.lists ?? []).filter(list => list.listType === LIST_TYPE_MILESTONE)
    return remote && taskId ? [{ remote, taskId, held }] : []
  })

  const seen = new Map<string, RemoteMilestone & { repository: string | null }>()
  for (const { remote } of stated) {
    if (remote.milestone) seen.set(remote.milestone.nodeId, { ...remote.milestone, repository: remote.repository })
  }

  const writes: Prisma.PrismaPromise<unknown>[] = []
  const listIds = new Map<string, string>()
  if (seen.size > 0) {
    // Same saving as applyLabels (AWTD-1315): a milestone the task already
    // holds is served from the held row, which carries the name and description
    // `milestoneListDrift` compares. Only unheld nodes are read.
    const { resolved, unresolved } = resolveHeldLists(
      seen.keys(),
      stated.flatMap(({ held }) => held),
      LIST_TYPE_MILESTONE,
    )
    const known =
      unresolved.length > 0
        ? await prisma.taskList.findMany({
            where: { remoteNodeId: { in: unresolved } },
            select: MILESTONE_LIST_SELECT,
          })
        : []
    for (const list of [...resolved.values(), ...known]) {
      listIds.set(list.remoteNodeId as string, list.id)
      const milestone = seen.get(list.remoteNodeId as string)!
      const drift = milestoneListDrift(milestone, milestone.repository, list)
      if (drift) writes.push(prisma.taskList.update({ where: { id: list.id }, data: drift }))
    }

    const fresh = [...seen.values()].filter(milestone => !listIds.has(milestone.nodeId))
    if (fresh.length > 0) {
      await prisma.taskList.createMany({
        data: fresh.map(milestone => ({
          name: milestone.title,
          color: MILESTONE_LIST_COLOR,
          description: milestoneListDescription(milestone.repository, milestone.dueOn),
          ownerId: board.ownerId,
          listType: LIST_TYPE_MILESTONE,
          remoteNodeId: milestone.nodeId,
        })),
        // Another job may have met the same milestone: the node id is unique.
        skipDuplicates: true,
      })
      const made = await prisma.taskList.findMany({
        where: { remoteNodeId: { in: fresh.map(milestone => milestone.nodeId) } },
        select: MILESTONE_LIST_SELECT,
      })
      for (const list of made) listIds.set(list.remoteNodeId as string, list.id)
      await RedisCache.invalidate.userLists(board.ownerId).catch(err => {
        log.warn({ err, projectId: board.projectId }, 'Failed to clear the board owner\u2019s list cache')
      })
    }
  }

  for (const { remote, taskId, held } of stated) {
    const plan = planMilestone(remote, held.map(list => list.remoteNodeId as string))
    if (isEmptyMilestonePlan(plan)) continue
    const connect = plan.join && listIds.has(plan.join) ? [{ id: listIds.get(plan.join)! }] : []
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
