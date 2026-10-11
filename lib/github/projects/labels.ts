/**
 * GitHub's labels → membership in Astrid's label-flavor lists (AWTD-1188, P6c).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4. Pure, like relations.ts:
 *
 *   remoteLabels(item)          what GitHub says, as label node ids
 *   planLabels(remote, held)    the label lists to join and to leave
 *   labelListDrift(label, list) a rename or recolour to carry over
 *
 * A label is keyed by its NODE id, which is (repo, label): the same name in
 * two repos is two labels, and a renamed label is still the one it was. Only
 * lists that mirror a GitHub label are ever planned against, so a label a
 * person gave a mirrored task in Astrid is Astrid's own and stays.
 *
 * Inbound only. A label change made in Astrid is refused, not written
 * through (lib/backends/github-labels.ts).
 */

import type { RemoteProjectItem } from './apply'

export interface RemoteLabel {
  nodeId: string
  name: string
  /** GitHub's bare hex, e.g. "d73a4a". */
  color: string
}

export interface RemoteLabels {
  /** owner/repo: what tells two labels of one name apart for a person. */
  repository: string | null
  labels: RemoteLabel[]
  /** False when GitHub has more labels than were read: add, never remove. */
  complete: boolean
}

/** Null when the item has no labels to mirror: a draft, or redacted. */
export function remoteLabels(item: RemoteProjectItem): RemoteLabels | null {
  const content = item.content
  if (item.type === 'REDACTED' || !content || content.__typename === 'DraftIssue') return null

  const labels = content.labels?.nodes.map(node => ({ nodeId: node.id, name: node.name, color: node.color })) ?? []
  return {
    repository: content.repository?.nameWithOwner ?? null,
    labels,
    // An item hydrated without the field says nothing about its labels.
    complete: Boolean(content.labels) && content.labels!.totalCount <= labels.length,
  }
}

export interface LabelPlan {
  /** Label node ids whose lists the task joins. */
  join: string[]
  /** Label node ids whose lists the task leaves. */
  leave: string[]
}

export function planLabels(remote: RemoteLabels, heldNodeIds: readonly string[]): LabelPlan {
  const wanted = new Set(remote.labels.map(label => label.nodeId))
  const held = new Set(heldNodeIds)
  return {
    join: [...wanted].filter(nodeId => !held.has(nodeId)),
    leave: remote.complete ? [...held].filter(nodeId => !wanted.has(nodeId)) : [],
  }
}

export function isEmptyLabelPlan(plan: LabelPlan): boolean {
  return plan.join.length === 0 && plan.leave.length === 0
}

/** GitHub's bare hex as a list colour. */
export function labelListColor(hex: string): string {
  return `#${hex.replace(/^#/, '').toLowerCase()}`
}

/** What a label's list must change to match it; null when it already does. */
export function labelListDrift(
  label: RemoteLabel,
  list: { name: string; color: string },
): { name?: string; color?: string } | null {
  const color = labelListColor(label.color)
  const patch = {
    ...(label.name !== list.name ? { name: label.name } : {}),
    ...(color !== list.color ? { color } : {}),
  }
  return Object.keys(patch).length > 0 ? patch : null
}
