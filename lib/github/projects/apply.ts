/**
 * Applying a GitHub ProjectV2Item to Astrid's replica (AWTD-1149, P4a).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4, §8.7, §9.1–9.3, §13.2.
 * Pure functions — no network, no database — so every rule is testable from
 * a fixture:
 *
 *   normaliseItem(item, binding)   GitHub's shape → Astrid's view of the task
 *   diffTask(normalised, replica)  only the fields whose VALUES differ
 *   planItemApply(...)             create | update | leave | noop | skip, and
 *                                  what it costs (≤ 4 queries, §13.3)
 *
 * The hydrate step (P4b) supplies the item, the queue (P4d) executes the plan
 * through the task services. The replica always converges to GitHub: values
 * are compared, never timestamps, so an echo of Astrid's own write is a no-op
 * and out-of-order webhooks are harmless.
 */

// ── GitHub's shape (the hydration fragment's result) ────────────────────────

export type RemoteFieldValue =
  | { __typename: 'ProjectV2ItemFieldSingleSelectValue'; optionId: string; name?: string; field: { id: string } }
  | { __typename: 'ProjectV2ItemFieldDateValue'; date: string; field: { id: string } }
  | { __typename: 'ProjectV2ItemFieldNumberValue'; number: number; field: { id: string } }
  | { __typename: 'ProjectV2ItemFieldTextValue'; text: string; field: { id: string } }
  | { __typename: string; field?: { id: string } }

export interface RemoteProjectItem {
  id: string
  isArchived: boolean
  type: 'ISSUE' | 'DRAFT_ISSUE' | 'PULL_REQUEST' | 'REDACTED'
  updatedAt: string
  content: null | {
    __typename: 'Issue' | 'DraftIssue' | 'PullRequest'
    id: string
    title: string
    body: string | null
    updatedAt: string
    number?: number
    url?: string
    state?: 'OPEN' | 'CLOSED' | 'MERGED'
    stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'REOPENED' | 'DUPLICATE' | null
    repository?: { nameWithOwner: string }
  }
  fieldValues: { nodes: RemoteFieldValue[] }
}

/** The part of GitHubProjectBinding apply reads. */
export interface BindingFieldMap {
  statusFieldId: string | null
  /** optionId → a status role ('ready' | 'doing' | 'waiting' | a custom role) or 'done'. */
  statusOptionMap: Record<string, string>
  priorityFieldId: string | null
  /** optionId → 0..3. */
  priorityOptionMap: Record<string, number> | null
  dueFieldId: string | null
}

// ── Astrid's view ───────────────────────────────────────────────────────────

export type RemoteKind = 'issue' | 'draft' | 'pull_request'

/** The fields GitHub owns that P4 mirrors (§9.1). */
export interface MirroredFields {
  title: string
  description: string
  completed: boolean
  /** canceled | duplicate | not_planned; null = completed normally, or open. */
  closedReason: string | null
  statusRole: string | null
  priority: number
  dueDateTime: Date | null
  isAllDay: boolean
}

export interface NormalisedItem {
  itemNodeId: string
  archived: boolean
  /** The CONTENT's node id — the task's identity, stable across transfers. */
  remoteNodeId: string
  remoteKind: RemoteKind
  /** The content's updatedAt: the body-conflict base (§8.7), bookkeeping only. */
  remoteVersion: string
  /** owner/repo#N; null for drafts until converted (§9.3). */
  identifier: string | null
  url: string | null
  task: MirroredFields
}

/** The replica as apply needs to see it. */
export interface ReplicaTask extends Omit<MirroredFields, 'description'> {
  id: string
  description: string | null
  identifier: string | null
  remoteKind: string | null
  remoteVersion: string | null
}

export const DONE_OPTION = 'done'

const KIND: Record<NonNullable<RemoteProjectItem['content']>['__typename'], RemoteKind> = {
  Issue: 'issue',
  DraftIssue: 'draft',
  PullRequest: 'pull_request',
}

function fieldValue(item: RemoteProjectItem, fieldId: string | null): RemoteFieldValue | undefined {
  if (!fieldId) return undefined
  return item.fieldValues.nodes.find(value => value.field?.id === fieldId)
}

function selectedOption(item: RemoteProjectItem, fieldId: string | null): string | null {
  const value = fieldValue(item, fieldId)
  return value && 'optionId' in value ? value.optionId : null
}

/** GitHub's closed state → completed + closedReason (Astrid's vocabulary). */
function closedState(content: NonNullable<RemoteProjectItem['content']>): { closed: boolean; closedReason: string | null } {
  if (content.state === 'MERGED') return { closed: true, closedReason: null }
  if (content.state !== 'CLOSED') return { closed: false, closedReason: null }
  if (content.__typename === 'PullRequest') return { closed: true, closedReason: 'canceled' }
  switch (content.stateReason) {
    case 'NOT_PLANNED':
      return { closed: true, closedReason: 'not_planned' }
    case 'DUPLICATE':
      return { closed: true, closedReason: 'duplicate' }
    default:
      return { closed: true, closedReason: null }
  }
}

export function normaliseItem(item: RemoteProjectItem, binding: BindingFieldMap): NormalisedItem | null {
  const content = item.content
  // REDACTED: the installation cannot see the content. Nothing to mirror.
  if (item.type === 'REDACTED' || !content) return null

  const { closed, closedReason } = closedState(content)
  const statusOption = selectedOption(item, binding.statusFieldId)
  const mapped = statusOption ? binding.statusOptionMap[statusOption] ?? null : null
  // Done, or closed on GitHub, is completed. A done task holds no live lane:
  // the board's invariant is "status set ⇒ not completed".
  const completed = closed || mapped === DONE_OPTION
  const statusRole = completed ? null : mapped

  const priorityOption = selectedOption(item, binding.priorityFieldId)
  const priority = priorityOption ? binding.priorityOptionMap?.[priorityOption] ?? 0 : 0

  const due = fieldValue(item, binding.dueFieldId)
  const dueDateTime = due && 'date' in due && due.date ? new Date(`${due.date}T00:00:00.000Z`) : null

  const identifier =
    content.repository && typeof content.number === 'number'
      ? `${content.repository.nameWithOwner}#${content.number}`
      : null

  return {
    itemNodeId: item.id,
    archived: item.isArchived,
    remoteNodeId: content.id,
    remoteKind: KIND[content.__typename],
    remoteVersion: content.updatedAt,
    identifier,
    url: content.url ?? null,
    task: {
      title: content.title,
      description: content.body ?? '',
      completed,
      closedReason: completed ? closedReason : null,
      statusRole,
      priority,
      dueDateTime,
      isAllDay: dueDateTime !== null,
    },
  }
}

// ── Diff ────────────────────────────────────────────────────────────────────

export type TaskPatch = Partial<MirroredFields & { identifier: string | null; remoteKind: string; remoteVersion: string }>

/** Fields a person sees change; the rest of a patch is bookkeeping (no events). */
export type ChangedField = keyof MirroredFields | 'identifier'

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

export function diffTask(normalised: NormalisedItem, replica: ReplicaTask): { patch: TaskPatch; changed: ChangedField[] } {
  const patch: TaskPatch = {}
  const changed: ChangedField[] = []
  const remote = normalised.task

  const visible: Array<[ChangedField, boolean, () => void]> = [
    ['title', remote.title !== replica.title, () => (patch.title = remote.title)],
    ['description', remote.description !== (replica.description ?? ''), () => (patch.description = remote.description)],
    ['completed', remote.completed !== replica.completed, () => (patch.completed = remote.completed)],
    ['closedReason', remote.closedReason !== replica.closedReason, () => (patch.closedReason = remote.closedReason)],
    ['statusRole', remote.statusRole !== replica.statusRole, () => (patch.statusRole = remote.statusRole)],
    ['priority', remote.priority !== replica.priority, () => (patch.priority = remote.priority)],
    ['dueDateTime', !sameDay(remote.dueDateTime, replica.dueDateTime), () => (patch.dueDateTime = remote.dueDateTime)],
    ['isAllDay', remote.isAllDay !== replica.isAllDay, () => (patch.isAllDay = remote.isAllDay)],
    ['identifier', normalised.identifier !== replica.identifier, () => (patch.identifier = normalised.identifier)],
  ]
  for (const [field, differs, apply] of visible) {
    if (differs) {
      apply()
      changed.push(field)
    }
  }

  // Bookkeeping: written when it differs, but nobody is told.
  if (normalised.remoteKind !== replica.remoteKind) patch.remoteKind = normalised.remoteKind
  if (normalised.remoteVersion !== replica.remoteVersion) patch.remoteVersion = normalised.remoteVersion

  return { patch, changed }
}

// ── Plan ────────────────────────────────────────────────────────────────────

export interface ItemMembership {
  itemNodeId: string
  archived: boolean
}

export type ItemApplyPlan =
  | { action: 'create'; data: NormalisedItem; queries: number }
  | { action: 'update'; patch: TaskPatch; changed: ChangedField[]; addMembership: boolean; queries: number }
  | { action: 'leave'; queries: number }
  | { action: 'noop'; queries: 0 }
  | { action: 'skip'; reason: 'redacted'; queries: 0 }

/**
 * What applying one hydrated item would do, and its query cost:
 *   create  task.create (with its list) + GitHubProjectItem.create        = 2
 *   update  task.update, plus GitHubProjectItem.create if new to the list = 1–2
 *   leave   GitHubProjectItem archive + list membership removal            = 2
 * The DeletionLog/TaskEvent/SSE the executor emits ride on those writes.
 */
export function planItemApply(input: {
  item: RemoteProjectItem
  binding: BindingFieldMap
  replica: ReplicaTask | null
  membership: ItemMembership | null
}): ItemApplyPlan {
  const normalised = normaliseItem(input.item, input.binding)
  if (!normalised) return { action: 'skip', reason: 'redacted', queries: 0 }

  if (normalised.archived) {
    // Archived leaves the list; the task itself stays (§8.7 deletions).
    return input.membership && !input.membership.archived && input.replica
      ? { action: 'leave', queries: 2 }
      : { action: 'noop', queries: 0 }
  }

  if (!input.replica) return { action: 'create', data: normalised, queries: 2 }

  const { patch, changed } = diffTask(normalised, input.replica)
  const addMembership = !input.membership || input.membership.archived
  const writes = Object.keys(patch).length > 0 ? 1 : 0
  if (writes === 0 && !addMembership) return { action: 'noop', queries: 0 }
  return { action: 'update', patch, changed, addMembership, queries: writes + (addMembership ? 1 : 0) }
}
