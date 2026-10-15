/**
 * Recurrence on a GitHub board: completing an occurrence SPAWNS the next issue
 * (AWTD-1118, P6b). Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §10.
 *
 * A personal list rolls the same row forward — `completed: false`, the next due
 * date, `occurrenceCount + 1` — and that stays. On a GitHub-backed list the
 * completed issue stays closed as history and the next occurrence is a NEW
 * issue linked to it, because an issue is a thing on github.com with a number,
 * a timeline and comments: reopening one every Monday would rewrite history
 * rather than record it.
 *
 * Pure, like apply.ts and write.ts — no network, no database:
 *
 *   decideRecurrence(…)        roll forward | spawn | neither
 *   recurDedupeKey(…)          one job per occurrence
 *   spawnBody / nextOccurrenceComment
 *                              the two halves of the link between occurrences
 *   planSpawnContent(…)        step 1: the new issue (or draft)
 *   planSpawnFields(…)         step 3: its card's field values, per project
 *
 * Step 2 is `ADD_ITEM_DOCUMENT` from create.ts, once per project: the same
 * three-request shape P5b needed, and for the same reason — each step needs
 * the previous one's ids.
 */

import { DONE_OPTION, type BindingFieldMap, type RemoteFieldValue } from './apply'

/**
 * How a list's repeating tasks advance (spec §11.2, `list.supports.repeatMode`).
 * In `spawn` mode a client sends the completion and does NOT roll forward
 * locally; the successor arrives by SSE or delta.
 */
export type RepeatMode = 'roll_forward' | 'spawn'

/** What a `recur` sync job carries. The occurrence makes the dedupe key reproducible. */
export interface RecurPayload {
  taskId: string
  /** The PREDECESSOR's count, so the key is the same from either trigger. */
  occurrenceCount: number
}

/**
 * One spawn per occurrence, however many times it is asked for. An Astrid
 * completion and the `issues.closed` webhook it causes race to the same key,
 * so GitHub gets one issue rather than two (§10.1, "Exactly once").
 */
export function recurDedupeKey(taskId: string, occurrenceCount: number): string {
  return `recur:${taskId}:${occurrenceCount}`
}

export const PREVIOUS_OCCURRENCE_PREFIX = 'Previous occurrence: '
export const NEXT_OCCURRENCE_PREFIX = 'Next occurrence: '

/**
 * What a completion does to a repeating series. Both "not planned" and a
 * terminated series end it: `closedReason` is the same rule the local mode
 * already applies in resolveRepeatingTaskCompletion — "we're not doing this
 * one" and "this one is done, schedule the next" are opposite intents.
 */
export function decideRecurrence(args: {
  repeatMode: RepeatMode
  repeating: string
  wasCompleted: boolean
  isNowCompleted: boolean
  closedReason: string | null
  shouldTerminate: boolean
}): 'roll_forward' | 'spawn' | 'none' {
  if (!args.isNowCompleted || args.wasCompleted) return 'none'
  if (args.repeating === 'never' || !args.repeating) return 'none'
  if (args.closedReason) return 'none'
  if (args.shouldTerminate) return 'none'
  return args.repeatMode === 'spawn' ? 'spawn' : 'roll_forward'
}

/**
 * The successor's body: the predecessor's, plus a line pointing back at it.
 * A draft has no `owner/repo#N` to point at, so it gets no footer rather than
 * a dangling one.
 */
export function spawnBody(body: string | null, predecessorIdentifier: string | null): string {
  const base = body ?? ''
  if (!predecessorIdentifier) return base
  const footer = `${PREVIOUS_OCCURRENCE_PREFIX}${predecessorIdentifier}`
  return base ? `${base}\n\n${footer}` : footer
}

/**
 * The comment left on the predecessor, which gives GitHub's timeline a
 * cross-reference the other way. Null for a successor with no number.
 */
export function nextOccurrenceComment(successorIdentifier: string | null): string | null {
  if (!successorIdentifier) return null
  const number = successorIdentifier.split('#')[1]
  if (!number) return null
  return `${NEXT_OCCURRENCE_PREFIX}#${number}`
}

/**
 * The option a spawned card's Status starts on: the board's first non-done
 * state, normally `ready` (§10.1). Object key order is GitHub's own option
 * order, as the binding recorded it. Null when the board bound no such option,
 * in which case the card is left where GitHub puts a new one.
 */
export function firstNonDoneOption(statusOptionMap: Record<string, string>): string | null {
  for (const [optionId, role] of Object.entries(statusOptionMap)) {
    if (role !== DONE_OPTION) return optionId
  }
  return null
}

/** The predecessor, as a spawn needs to see it. */
export interface SpawnPredecessor {
  remoteKind: 'issue' | 'draft' | 'pull_request'
  /** owner/repo#N; null for a draft. */
  identifier: string | null
  title: string
  body: string | null
  /** The repo the successor is created in — the predecessor's own. Null for a draft. */
  repositoryNodeId: string | null
  labelIds: string[]
  assigneeIds: string[]
  milestoneId: string | null
}

export interface SpawnPlan {
  document: string
  variables: Record<string, unknown>
}

/**
 * Step 1: the successor's content. An issue is created in the predecessor's own
 * repo with its labels, assignees and milestone; a draft spawns a draft in the
 * same project. The copies are omitted rather than sent empty, so a successor
 * never looks deliberately unassigned.
 */
export function planSpawnContent(predecessor: SpawnPredecessor, target: { projectNodeId: string }): SpawnPlan {
  const body = spawnBody(predecessor.body, predecessor.identifier)

  if (predecessor.remoteKind === 'draft' || !predecessor.repositoryNodeId) {
    return {
      document: /* GraphQL */ `mutation($p: ID!, $t: String!, $b: String) {
  m0: addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b }) {
    projectItem { id content { ... on DraftIssue { id updatedAt } } }
  }
}`,
      variables: { p: target.projectNodeId, t: predecessor.title, b: body },
    }
  }

  const params = ['$r: ID!', '$t: String!', '$b: String']
  const input = ['repositoryId: $r', 'title: $t', 'body: $b']
  const variables: Record<string, unknown> = { r: predecessor.repositoryNodeId, t: predecessor.title, b: body }

  if (predecessor.labelIds.length > 0) {
    params.push('$l: [ID!]')
    input.push('labelIds: $l')
    variables.l = predecessor.labelIds
  }
  if (predecessor.assigneeIds.length > 0) {
    params.push('$a: [ID!]')
    input.push('assigneeIds: $a')
    variables.a = predecessor.assigneeIds
  }
  if (predecessor.milestoneId) {
    params.push('$ms: ID')
    input.push('milestoneId: $ms')
    variables.ms = predecessor.milestoneId
  }

  return {
    document: /* GraphQL */ `mutation(${params.join(', ')}) {
  m0: createIssue(input: { ${input.join(', ')} }) {
    issue { id number updatedAt repository { nameWithOwner } }
  }
}`,
    variables,
  }
}

/**
 * What a spawn must read off the predecessor's CONTENT, which the hydration
 * fragment does not carry: the repo to create the successor in, its milestone,
 * and the label and assignee node ids to copy. The predecessor's project
 * memberships come from Astrid's own GitHubProjectItem rows, and each card's
 * field values from hydrating that item — so this asks GitHub only for what
 * nothing else already knows.
 */
export const SPAWN_SOURCE_QUERY = /* GraphQL */ `
query SpawnSource($id: ID!) {
  node(id: $id) {
    __typename
    ... on Issue {
      id
      title
      body
      number
      repository { id nameWithOwner }
      milestone { id }
      labels(first: 20) { nodes { id } }
      assignees(first: 10) { nodes { id } }
    }
    ... on DraftIssue {
      id
      title
      body
      assignees(first: 10) { nodes { id } }
    }
  }
  rateLimit { cost remaining resetAt }
}`

interface SpawnSourceNode {
  __typename?: string
  id?: string
  title?: string
  body?: string | null
  number?: number
  repository?: { id?: string; nameWithOwner?: string } | null
  milestone?: { id?: string } | null
  labels?: { nodes?: Array<{ id?: string }> } | null
  assignees?: { nodes?: Array<{ id?: string }> } | null
}

/**
 * GitHub's answer → the predecessor a spawn plans from. Null when GitHub no
 * longer has the content, or has it as something a spawn cannot copy (a pull
 * request is never a recurring task).
 */
export function parseSpawnSource(result: { node?: SpawnSourceNode | null }): SpawnPredecessor | null {
  const node = result.node
  if (!node?.id || (node.__typename !== 'Issue' && node.__typename !== 'DraftIssue')) return null

  const ids = (list?: { nodes?: Array<{ id?: string }> } | null) =>
    (list?.nodes ?? []).flatMap(n => (n.id ? [n.id] : []))

  if (node.__typename === 'DraftIssue') {
    return {
      remoteKind: 'draft',
      identifier: null,
      title: node.title ?? '',
      body: node.body ?? null,
      repositoryNodeId: null,
      labelIds: [],
      assigneeIds: ids(node.assignees),
      milestoneId: null,
    }
  }

  return {
    remoteKind: 'issue',
    identifier:
      node.repository?.nameWithOwner && node.number ? `${node.repository.nameWithOwner}#${node.number}` : null,
    title: node.title ?? '',
    body: node.body ?? null,
    repositoryNodeId: node.repository?.id ?? null,
    labelIds: ids(node.labels),
    assigneeIds: ids(node.assignees),
    milestoneId: node.milestone?.id ?? null,
  }
}

/** The comment that cross-references the successor on the predecessor's timeline. */
export const ADD_COMMENT_DOCUMENT = /* GraphQL */ `mutation($s: ID!, $b: String!) {
  m0: addComment(input: { subjectId: $s, body: $b }) { clientMutationId }
}`

/** One project the predecessor was in, and the successor's new card on it. */
export interface SpawnMembership {
  projectNodeId: string
  /** The successor's item, from step 2. */
  itemNodeId: string
  binding: BindingFieldMap
  /** The PREDECESSOR's field values on this project. */
  fieldValues: RemoteFieldValue[]
}

/** A hydrated field value as a `ProjectV2FieldValue` input, or null for a type the mirror does not own. */
function asFieldInput(value: RemoteFieldValue): Record<string, unknown> | null {
  switch (value.__typename) {
    case 'ProjectV2ItemFieldSingleSelectValue':
      return { singleSelectOptionId: (value as { optionId: string }).optionId }
    case 'ProjectV2ItemFieldDateValue':
      return { date: (value as { date: string }).date }
    case 'ProjectV2ItemFieldNumberValue':
      return { number: (value as { number: number }).number }
    case 'ProjectV2ItemFieldTextValue':
      return { text: (value as { text: string }).text }
    default:
      // Iteration, users, labels, milestone, reviewers: not ours to copy. The
      // successor is left as GitHub makes it rather than given a guessed value.
      return null
  }
}

/**
 * Step 3: the successor's card on every project the predecessor was in — its
 * field values copied, EXCEPT Status, which resets to the first non-done
 * option, and the due field, which carries the next occurrence's date (§10.1).
 *
 * A due date the series no longer has clears the field, so a spawned card never
 * inherits a date that has passed.
 */
export function planSpawnFields(memberships: readonly SpawnMembership[], nextDue: Date | null): SpawnPlan {
  const params: string[] = []
  const fields: string[] = []
  const variables: Record<string, unknown> = {}
  let n = 0

  const write = (m: SpawnMembership, fieldId: string, value: Record<string, unknown> | null) => {
    const alias = `m${n++}`
    const p = `${alias}_p`
    const i = `${alias}_i`
    const f = `${alias}_f`
    variables[p] = m.projectNodeId
    variables[i] = m.itemNodeId
    variables[f] = fieldId
    if (value === null) {
      params.push(`$${p}: ID!`, `$${i}: ID!`, `$${f}: ID!`)
      fields.push(
        `${alias}: clearProjectV2ItemFieldValue(input: { projectId: $${p}, itemId: $${i}, fieldId: $${f} }) { projectV2Item { id } }`,
      )
      return
    }
    const v = `${alias}_v`
    variables[v] = value
    params.push(`$${p}: ID!`, `$${i}: ID!`, `$${f}: ID!`, `$${v}: ProjectV2FieldValue!`)
    fields.push(
      `${alias}: updateProjectV2ItemFieldValue(input: { projectId: $${p}, itemId: $${i}, fieldId: $${f}, value: $${v} }) { projectV2Item { id } }`,
    )
  }

  for (const m of memberships) {
    const { binding } = m

    // Status: the board's first non-done state, whatever the predecessor ended on.
    if (binding.statusFieldId) {
      const option = firstNonDoneOption(binding.statusOptionMap)
      if (option) write(m, binding.statusFieldId, { singleSelectOptionId: option })
    }

    // The due field: the next occurrence's date, or cleared.
    if (binding.dueFieldId) {
      write(m, binding.dueFieldId, nextDue ? { date: nextDue.toISOString().slice(0, 10) } : null)
    }

    // Everything else the predecessor's card carried, as it stands.
    for (const value of m.fieldValues) {
      const fieldId = value.field?.id
      if (!fieldId) continue
      if (fieldId === binding.statusFieldId || fieldId === binding.dueFieldId) continue
      const input = asFieldInput(value)
      if (input) write(m, fieldId, input)
    }
  }

  return {
    document: fields.length === 0 ? '' : `mutation(${params.join(', ')}) { ${fields.join(' ')} }`,
    variables,
  }
}
