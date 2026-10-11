/**
 * Write-through: an Astrid edit to a GitHub-backed task as GitHub mutations
 * (AWTD-1116 P5a). Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.6, §8.7,
 * §9.1–9.2.
 *
 * Pure. Given the task as the replica holds it, its project memberships, and
 * the row data the service is about to write, it decides what GitHub must be
 * told — as ONE GraphQL document of aliased mutations — or why it can't be:
 *
 *   title / description   updateIssue | updateProjectV2DraftIssue; a PR's
 *                         content is read-only and the edit is refused
 *   statusRole            the bound Status option, per project (clear = Inbox)
 *   completed             the Done option, and close/reopen an issue (§8.7:
 *                         "Done also closes"); closedReason 'not_planned'
 *                         closes as NOT_PLANNED
 *   priority / due        the bound Priority option / Date field, per project
 *
 * Fields GitHub does not own (reminders, timers, personal lists) are not in
 * the plan; the service writes them locally as for any task.
 */

import type { BindingFieldMap } from './apply'
import { DONE_OPTION } from './apply'

/** The task as the replica holds it: identity plus the mirrored values now. */
export interface WritableTask {
  /** The content's node id; for a draft, its DI_… id. */
  remoteNodeId: string
  remoteKind: 'issue' | 'draft' | 'pull_request'
  remoteVersion: string | null
  title: string
  description: string | null
  completed: boolean
  closedReason: string | null
  statusRole: string | null
  priority: number
  dueDateTime: Date | null
}

export interface WritableMembership {
  projectNodeId: string
  itemNodeId: string
  binding: BindingFieldMap
}

export type WriteRefusal =
  | { refused: 'field_not_bound'; field: string }
  | { refused: 'no_option_for_role'; role: string }
  | { refused: 'pull_request_close' }
  | { refused: 'pull_request_content' }

export interface MutationPlan {
  /** The whole document, ready to send. Empty when nothing goes to GitHub. */
  document: string
  variables: Record<string, unknown>
  /** Aliases whose result carries the content's new updatedAt. */
  versionAliases: string[]
  /** alias → project node id, for items this plan adds (their ids come back). */
  addedItems: Record<string, string>
  /** Items this plan removes from their projects. */
  removedItems: string[]
  /** The body is being edited: the caller must check remoteVersion first. */
  editsBody: boolean
}

/** Row keys GitHub owns; anything else is Astrid-only. */
export const MIRRORED_KEYS = ['title', 'description', 'completed', 'closedReason', 'statusRole', 'priority', 'dueDateTime'] as const

const sameDay = (a: unknown, b: Date | null) =>
  (a == null && b == null) ||
  (a != null && b != null && new Date(a as string).toISOString().slice(0, 10) === b.toISOString().slice(0, 10))

/**
 * The mirrored fields this write actually CHANGES. Clients often send the
 * whole task on save; an unchanged priority must not be refused for having no
 * Priority field, nor re-sent to GitHub.
 */
export function changedMirroredFields(task: WritableTask, data: Record<string, unknown>): Record<string, unknown> {
  const changed: Record<string, unknown> = {}
  for (const key of MIRRORED_KEYS) {
    if (!(key in data)) continue
    const next = data[key]
    const now = key === 'description' ? task.description ?? '' : task[key]
    const same = key === 'dueDateTime' ? sameDay(next, task.dueDateTime) : (key === 'description' ? next ?? '' : next) === now
    if (!same) changed[key] = next
  }
  return changed
}

function optionFor<V>(map: Record<string, V> | null, wanted: V): string | null {
  if (!map) return null
  return Object.entries(map).find(([, value]) => value === wanted)?.[0] ?? null
}

class Builder {
  private params: string[] = []
  private fields: string[] = []
  readonly variables: Record<string, unknown> = {}
  readonly versionAliases: string[] = []
  private n = 0

  add(mutation: string, args: Record<string, [type: string, value: unknown]>, selection: string, carriesVersion = false): string {
    const alias = `m${this.n++}`
    const input: string[] = []
    for (const [name, [type, value]] of Object.entries(args)) {
      const variable = `${alias}_${name}`
      this.params.push(`$${variable}: ${type}`)
      this.variables[variable] = value
      input.push(`${name}: $${variable}`)
    }
    this.fields.push(`${alias}: ${mutation}(input: { ${input.join(', ')} }) { ${selection} }`)
    if (carriesVersion) this.versionAliases.push(alias)
    return alias
  }

  /** A field value: the variable is the whole `value` input object. */
  addFieldValue(m: WritableMembership, fieldId: string, value: Record<string, unknown> | null) {
    if (value === null) {
      this.add(
        'clearProjectV2ItemFieldValue',
        { projectId: ['ID!', m.projectNodeId], itemId: ['ID!', m.itemNodeId], fieldId: ['ID!', fieldId] },
        'projectV2Item { id }',
      )
    } else {
      this.add(
        'updateProjectV2ItemFieldValue',
        {
          projectId: ['ID!', m.projectNodeId],
          itemId: ['ID!', m.itemNodeId],
          fieldId: ['ID!', fieldId],
          value: ['ProjectV2FieldValue!', value],
        },
        'projectV2Item { id }',
      )
    }
  }

  document(): string {
    return this.fields.length === 0 ? '' : `mutation(${this.params.join(', ')}) { ${this.fields.join(' ')} }`
  }
}

const CONTENT_SELECTION: Record<Exclude<WritableTask['remoteKind'], 'pull_request'>, string> = {
  issue: 'issue { id updatedAt }',
  draft: 'draftIssue { id updatedAt }',
}

/**
 * Board membership changes (P5c). Leaving a GitHub list removes the item from
 * that project — the issue itself stays on GitHub (§8.7: an Astrid delete on
 * a GitHub board means remove from project). Joining one adds the content.
 */
/**
 * An assignee change, as GitHub node ids (resolved by the caller). Agents are
 * never GitHub assignees (§8.6): assigning one arrives here as `to: null`.
 */
export interface AssigneeChange {
  from: string | null
  to: string | null
}

export interface MembershipChanges {
  remove: WritableMembership[]
  /** Project node ids the content joins. */
  add: string[]
}

export function planRemoteUpdate(
  task: WritableTask,
  memberships: WritableMembership[],
  rowData: Record<string, unknown>,
  changes: MembershipChanges = { remove: [], add: [] },
  assignee?: AssigneeChange,
): MutationPlan | WriteRefusal {
  const data = changedMirroredFields(task, rowData)
  const b = new Builder()
  const addedItems: Record<string, string> = {}

  for (const m of changes.remove) {
    b.add('deleteProjectV2Item', { projectId: ['ID!', m.projectNodeId], itemId: ['ID!', m.itemNodeId] }, 'deletedItemId')
  }
  for (const projectNodeId of changes.add) {
    const alias = b.add(
      'addProjectV2ItemById',
      { projectId: ['ID!', projectNodeId], contentId: ['ID!', task.remoteNodeId] },
      'item { id }',
    )
    addedItems[alias] = projectNodeId
  }
  const removed = new Set(changes.remove.map(m => m.itemNodeId))
  memberships = memberships.filter(m => !removed.has(m.itemNodeId))

  // ── Content: title and body ───────────────────────────────────────────
  const content: Record<string, [string, unknown]> = {}
  if (typeof data.title === 'string') content.title = ['String', data.title]
  if ('description' in data) content.body = ['String', (data.description as string | null) ?? '']
  if (Object.keys(content).length > 0) {
    // A PR's title and body are read-only here; its status and fields are not (§8.4, AWTD-1119).
    if (task.remoteKind === 'pull_request') return { refused: 'pull_request_content' }
    const [mutation, idArg] =
      task.remoteKind === 'issue' ? ['updateIssue', 'id'] : ['updateProjectV2DraftIssue', 'draftIssueId']
    b.add(mutation, { [idArg]: ['ID!', task.remoteNodeId], ...content }, CONTENT_SELECTION[task.remoteKind], true)
  }

  // ── Assignee ──────────────────────────────────────────────────────────
  if (assignee && assignee.from !== assignee.to) {
    if (task.remoteKind === 'draft') {
      b.add(
        'updateProjectV2DraftIssue',
        { draftIssueId: ['ID!', task.remoteNodeId], assigneeIds: ['[ID!]', assignee.to ? [assignee.to] : []] },
        'draftIssue { id updatedAt }',
        true,
      )
    } else {
      if (assignee.from) {
        b.add(
          'removeAssigneesFromAssignable',
          { assignableId: ['ID!', task.remoteNodeId], assigneeIds: ['[ID!]!', [assignee.from]] },
          'clientMutationId',
        )
      }
      if (assignee.to) {
        b.add(
          'addAssigneesToAssignable',
          { assignableId: ['ID!', task.remoteNodeId], assigneeIds: ['[ID!]!', [assignee.to]] },
          'clientMutationId',
        )
      }
    }
  }

  // ── Open / closed (issues; a PR is closed by merging, not from here) ──
  const completing = data.completed === true && !task.completed
  const reopening = data.completed === false && task.completed
  if ((completing || reopening) && task.remoteKind === 'pull_request') return { refused: 'pull_request_close' }
  if (task.remoteKind === 'issue' && completing) {
    const reason = data.closedReason === 'not_planned' ? 'NOT_PLANNED' : 'COMPLETED'
    b.add('closeIssue', { issueId: ['ID!', task.remoteNodeId], stateReason: ['IssueClosedStateReason', reason] }, 'issue { id updatedAt }', true)
  }
  if (task.remoteKind === 'issue' && reopening) {
    b.add('reopenIssue', { issueId: ['ID!', task.remoteNodeId] }, 'issue { id updatedAt }', true)
  }

  // ── Project fields, per membership ────────────────────────────────────
  for (const m of memberships) {
    const { binding } = m

    // Status: completing moves the card to Done; otherwise the lane asked for.
    let statusOption: string | null | undefined
    if (completing) {
      statusOption = optionFor(binding.statusOptionMap, DONE_OPTION) ?? undefined
    } else if ('statusRole' in data) {
      const role = data.statusRole as string | null
      if (role === null) statusOption = null
      else {
        statusOption = optionFor(binding.statusOptionMap, role)
        if (!statusOption) return { refused: 'no_option_for_role', role }
      }
    }
    if (statusOption !== undefined && binding.statusFieldId) {
      b.addFieldValue(m, binding.statusFieldId, statusOption === null ? null : { singleSelectOptionId: statusOption })
    }

    if ('priority' in data) {
      if (!binding.priorityFieldId) return { refused: 'field_not_bound', field: 'priority' }
      const option = optionFor(binding.priorityOptionMap, data.priority as number)
      b.addFieldValue(m, binding.priorityFieldId, option ? { singleSelectOptionId: option } : null)
    }

    if ('dueDateTime' in data) {
      if (!binding.dueFieldId) return { refused: 'field_not_bound', field: 'dueDateTime' }
      const due = data.dueDateTime as Date | string | null
      b.addFieldValue(m, binding.dueFieldId, due ? { date: new Date(due).toISOString().slice(0, 10) } : null)
    }
  }

  return {
    document: b.document(),
    variables: b.variables,
    versionAliases: b.versionAliases,
    addedItems,
    removedItems: changes.remove.map(m => m.itemNodeId),
    editsBody: 'description' in data,
  }
}

/** Removing a task from every project it is on: an Astrid delete on a GitHub board. */
export function planRemoveFromProjects(memberships: WritableMembership[]): MutationPlan {
  const b = new Builder()
  for (const m of memberships) {
    b.add('deleteProjectV2Item', { projectId: ['ID!', m.projectNodeId], itemId: ['ID!', m.itemNodeId] }, 'deletedItemId')
  }
  return {
    document: b.document(),
    variables: b.variables,
    versionAliases: [],
    addedItems: {},
    removedItems: memberships.map(m => m.itemNodeId),
    editsBody: false,
  }
}

/** The newest content updatedAt any mutation reported — the replica's new remoteVersion. */
export function versionFromResult(result: Record<string, unknown>, aliases: string[]): string | null {
  let newest: string | null = null
  for (const alias of aliases) {
    const node = Object.values((result[alias] ?? {}) as Record<string, { updatedAt?: string } | null>)[0]
    const at = node?.updatedAt
    if (at && (!newest || at > newest)) newest = at
  }
  return newest
}
