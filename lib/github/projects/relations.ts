/**
 * GitHub's sub-issues and issue dependencies → Astrid's parentTaskId and
 * TaskDependency rows (AWTD-1119, P6c).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4. Pure, like apply.ts:
 *
 *   remoteRelations(item)             what GitHub says, as content node ids
 *   planRelations(remote, replica, …) the relationship writes that converge on it
 *
 * A relationship is mirrored only when BOTH ends are mirrored tasks. Between
 * two mirrored tasks GitHub decides, so the replica converges by value. A
 * parent or a blocker that is a LOCAL Astrid task is Astrid's own: GitHub has
 * no opinion about it, and nothing here removes it.
 *
 * Cycles are accepted as they stand. Astrid's 409 on a circular wait applies
 * to Astrid writes only (services/task-dependency.service.ts); a replica that
 * refused GitHub's state would simply be wrong.
 */

import type { RemoteProjectItem } from './apply'

export interface RemoteRelations {
  parentNodeId: string | null
  blockedByNodeIds: string[]
  /** False when GitHub has more blockers than were read: add, never remove. */
  blockersComplete: boolean
}

/** Null when the item has no relationships to mirror: a draft, a PR, redacted. */
export function remoteRelations(item: RemoteProjectItem): RemoteRelations | null {
  const content = item.content
  if (item.type === 'REDACTED' || content?.__typename !== 'Issue') return null

  const blockedBy = content.blockedBy
  const blockedByNodeIds = blockedBy?.nodes.map(node => node.id) ?? []
  return {
    parentNodeId: content.parent?.id ?? null,
    blockedByNodeIds,
    // An item hydrated without the field says nothing about its blockers.
    blockersComplete: blockedBy !== undefined && blockedBy.totalCount <= blockedByNodeIds.length,
  }
}

/** The replica's side of one task's relationships. */
export interface ReplicaRelations {
  taskId: string
  parentTaskId: string | null
  /** The current parent is a local Astrid task, not a mirrored one. */
  parentIsLocal: boolean
  /** Tasks this one waits on that are themselves mirrored. */
  mirroredBlockerTaskIds: string[]
}

export interface RelationPlan {
  /** Present only when the parent changes; null detaches. */
  parentTaskId?: string | null
  addBlockers: string[]
  removeBlockers: string[]
}

export function planRelations(
  remote: RemoteRelations,
  replica: ReplicaRelations,
  taskIdOf: (nodeId: string) => string | undefined,
): RelationPlan {
  const mirrored = (nodeId: string | null) => {
    const taskId = nodeId ? taskIdOf(nodeId) : undefined
    return taskId && taskId !== replica.taskId ? taskId : null
  }
  const plan: RelationPlan = { addBlockers: [], removeBlockers: [] }

  const parent = mirrored(remote.parentNodeId)
  const keepLocalParent = parent === null && replica.parentIsLocal
  if (!keepLocalParent && parent !== replica.parentTaskId) plan.parentTaskId = parent

  const wanted = new Set(remote.blockedByNodeIds.flatMap(nodeId => mirrored(nodeId) ?? []))
  const held = new Set(replica.mirroredBlockerTaskIds)
  plan.addBlockers = [...wanted].filter(taskId => !held.has(taskId))
  if (remote.blockersComplete) plan.removeBlockers = [...held].filter(taskId => !wanted.has(taskId))

  return plan
}

export function isEmptyRelationPlan(plan: RelationPlan): boolean {
  return plan.parentTaskId === undefined && plan.addBlockers.length === 0 && plan.removeBlockers.length === 0
}
