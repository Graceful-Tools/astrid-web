/**
 * GitHub's milestones → membership in milestone-flavor lists (AWTD-1189, P6c-3).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4 — *"Milestone | A
 * read-only chip plus a virtual list"*. Pure, like labels.ts and relations.ts:
 *
 *   remoteMilestone(item)             what GitHub says, as a milestone node id
 *   planMilestone(remote, held)       the milestone list to join and to leave
 *   milestoneListDrift(ms, list)      a rename or a due-date change to carry over
 *
 * **Why a list flavor and not `virtualListType`.** The task asked whether the
 * existing virtual-list mechanism could express "tasks whose milestone is X"
 * without a new column. It cannot: `lib/virtual-list-utils.ts` is a client-side
 * filter over loaded tasks, keyed on a closed enum (`today`, `not-in-list`,
 * `assigned`), with nowhere to name a milestone. But labels already answered the
 * same question (AWTD-1188) — a GitHub label is a `listType: 'label'` list keyed
 * by `remoteNodeId`, and a task carries it by being a member. `lib/list-flavors.ts`
 * states the reason: *"multi-list membership already is labels"*. A milestone is
 * that shape too, so it is a third flavor and needs no schema change at all.
 *
 * **The one way a milestone is not a label: a task has at most ONE.** Labels are
 * a set, so `planLabels` joins and leaves independently. A milestone is a single
 * value, so the plan must leave every other milestone list the task holds — or an
 * issue moved from "v1.2" to "v1.3" ends up showing both, forever, since nothing
 * else would ever take the old one off.
 *
 * Inbound only. A milestone change made in Astrid is refused by name, the way a
 * label change is (lib/backends/github-labels.ts).
 */

import type { RemoteProjectItem } from './apply'

export interface RemoteMilestone {
  nodeId: string
  title: string
  /** GitHub's `dueOn`, an ISO timestamp, or null when the milestone has no date. */
  dueOn: string | null
}

export interface RemoteMilestoneState {
  /** owner/repo: what tells two milestones of one title apart for a person. */
  repository: string | null
  /** The milestone GitHub has on this item, or null when it has none. */
  milestone: RemoteMilestone | null
}

/**
 * Null when the item cannot carry a milestone — a draft issue or a redacted
 * item — which is different from carrying none. "No milestone" is a fact worth
 * acting on (leave the list you are on); "cannot say" must change nothing.
 */
export function remoteMilestone(item: RemoteProjectItem): RemoteMilestoneState | null {
  const content = item.content
  if (item.type === 'REDACTED' || !content || content.__typename === 'DraftIssue') return null

  const milestone = content.milestone
  return {
    repository: content.repository?.nameWithOwner ?? null,
    milestone: milestone ? { nodeId: milestone.id, title: milestone.title, dueOn: milestone.dueOn ?? null } : null,
  }
}

export interface MilestonePlan {
  /** The milestone list the task joins, or null. At most one, always. */
  join: string | null
  /** Milestone node ids whose lists the task leaves. */
  leave: string[]
}

/**
 * `heldNodeIds` is the milestone lists the task is on now. More than one means
 * an earlier state we are correcting, not something GitHub can produce.
 */
export function planMilestone(remote: RemoteMilestoneState, heldNodeIds: readonly string[]): MilestonePlan {
  const wanted = remote.milestone?.nodeId ?? null
  const held = new Set(heldNodeIds)
  return {
    join: wanted && !held.has(wanted) ? wanted : null,
    leave: [...held].filter(nodeId => nodeId !== wanted),
  }
}

export function isEmptyMilestonePlan(plan: MilestonePlan): boolean {
  return plan.join === null && plan.leave.length === 0
}

/**
 * A milestone list's colour. Milestones have no colour of their own on GitHub —
 * unlike labels, which carry a hex — so every one of them gets the same neutral
 * slate. Stated once here rather than at the call site, so the chips cannot
 * drift apart.
 */
export const MILESTONE_LIST_COLOR = '#64748b'

/**
 * What a milestone's list must change to match it; null when it already does.
 *
 * The due date rides in the list's `description` alongside the repo, because a
 * milestone list has nowhere else to put it and the repo alone is what tells two
 * same-titled milestones apart. Format: `owner/repo` or `owner/repo · 2026-11-01`.
 */
export function milestoneListDescription(repository: string | null, dueOn: string | null): string | null {
  const due = dueOn ? dueOn.slice(0, 10) : null
  if (repository && due) return `${repository} · ${due}`
  return repository ?? due
}

export function milestoneListDrift(
  milestone: RemoteMilestone,
  repository: string | null,
  list: { name: string; description?: string | null },
): { name?: string; description?: string | null } | null {
  const description = milestoneListDescription(repository, milestone.dueOn)
  const patch = {
    ...(milestone.title !== list.name ? { name: milestone.title } : {}),
    ...(description !== (list.description ?? null) ? { description } : {}),
  }
  return Object.keys(patch).length > 0 ? patch : null
}
