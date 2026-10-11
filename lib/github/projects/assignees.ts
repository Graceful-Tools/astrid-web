/**
 * GitHub's assignees → Astrid's assigneeIds (AWTD-1190, P6c).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.6, §9.5. Pure, like
 * relations.ts and labels.ts:
 *
 *   remoteAssignees(item)   what GitHub says, as user node ids
 *   planAssignees(...)      the assigneeIds the task should hold, or null
 *
 * A person is matched by `User.githubNodeId`. Someone with no Astrid identity
 * is skipped, not invented — and because the outbound write sends only the
 * DIFFERENCE (write.ts), they are never unassigned on GitHub for it either.
 *
 * GitHub's order is when each person was assigned; Astrid's says who is
 * primary. So people already assigned keep their order and newcomers follow,
 * which is what keeps a sync from undoing the primary a client just chose.
 */

import type { RemoteProjectItem } from './apply'

/** GitHub allows ten, so one page is always all of them. Matches MAX_ASSIGNEES. */
export const ASSIGNEES_PER_ITEM = 10

/** Null when the item says nothing about its assignees: redacted, or hydrated without the field. */
export function remoteAssignees(item: RemoteProjectItem): string[] | null {
  const content = item.content
  if (item.type === 'REDACTED' || !content?.assignees) return null
  return content.assignees.nodes.map(node => node.id)
}

export function planAssignees(args: {
  /** GitHub's assignees, as user node ids. */
  remote: readonly string[]
  /** The task's assigneeIds today (assigneeIdsOf). */
  held: readonly string[]
  /** An agent is never a GitHub assignee (§8.6): GitHub not naming it says nothing. */
  primaryIsAgent: boolean
  userIdByNodeId: ReadonlyMap<string, string>
}): string[] | null {
  const { held } = args
  const remote = args.remote.flatMap(nodeId => {
    const userId = args.userIdByNodeId.get(nodeId)
    return userId ? [userId] : []
  })
  const kept = held.filter((id, index) => remote.includes(id) || (index === 0 && args.primaryIsAgent))
  const next = [...kept, ...remote.filter(id => !held.includes(id))]
  return next.length === held.length && next.every((id, index) => id === held[index]) ? null : next
}
