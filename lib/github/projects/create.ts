/**
 * Creating a task on a GitHub board (AWTD-1116 P5b). Spec §8.7.
 *
 * Three requests, because each needs the previous one's ids:
 *
 *   1. the content — createIssue in the board's default repo, or a draft
 *      (addProjectV2DraftIssue, which also makes the project item)
 *   2. for an issue, addProjectV2ItemById. NOT createIssue's projectV2Ids:
 *      recorded 2026-10-10, GitHub adds the item asynchronously, so the
 *      create's own response lists no item to set fields on. Adding is
 *      idempotent — it returns the item GitHub may already have made.
 *   3. the field values (Status, priority, due), planned by write.ts as an
 *      edit from a blank card
 *
 * Content existing but a later step failing is a PARTIAL create: the task is
 * kept, marked syncState 'pending', and a writeback job finishes it.
 */

import type { WritableMembership, WritableTask } from './write'
import { planRemoteUpdate, type MutationPlan, type WriteRefusal } from './write'

export interface CreateTarget {
  projectNodeId: string
  /** "New task" creates an issue here; null → a draft. */
  defaultRepoNodeId: string | null
}

export interface CreatedContent {
  remoteNodeId: string
  remoteKind: 'issue' | 'draft'
  remoteVersion: string
  /** owner/repo#N for an issue; null for a draft. */
  identifier: string | null
  /** Known for a draft (made with its item); for an issue, after step 2. */
  itemNodeId: string | null
}

export function planCreateContent(target: CreateTarget, data: { title: string; description?: string | null }) {
  const body = data.description ?? ''
  if (target.defaultRepoNodeId) {
    return {
      document: /* GraphQL */ `mutation($r: ID!, $t: String!, $b: String) {
  m0: createIssue(input: { repositoryId: $r, title: $t, body: $b }) {
    issue { id number updatedAt repository { nameWithOwner } }
  }
}`,
      variables: { r: target.defaultRepoNodeId, t: data.title, b: body },
    }
  }
  return {
    document: /* GraphQL */ `mutation($p: ID!, $t: String!, $b: String) {
  m0: addProjectV2DraftIssue(input: { projectId: $p, title: $t, body: $b }) {
    projectItem { id content { ... on DraftIssue { id updatedAt } } }
  }
}`,
    variables: { p: target.projectNodeId, t: data.title, b: body },
  }
}

export function parseCreatedContent(result: Record<string, any>): CreatedContent {
  const issue = result.m0?.issue
  if (issue) {
    return {
      remoteNodeId: issue.id,
      remoteKind: 'issue',
      remoteVersion: issue.updatedAt,
      identifier: `${issue.repository.nameWithOwner}#${issue.number}`,
      itemNodeId: null,
    }
  }
  const item = result.m0?.projectItem
  if (item?.content?.id) {
    return {
      remoteNodeId: item.content.id,
      remoteKind: 'draft',
      remoteVersion: item.content.updatedAt,
      identifier: null,
      itemNodeId: item.id,
    }
  }
  throw new Error('GitHub create returned no content')
}

export const ADD_ITEM_DOCUMENT = /* GraphQL */ `mutation($p: ID!, $c: ID!) {
  m0: addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } }
}`

/**
 * Step 3: the field values, as an edit from a blank card — so the same
 * planner, with the same refusals, decides Status, priority and due.
 */
export function planInitialFields(
  content: CreatedContent,
  membership: WritableMembership,
  data: Record<string, unknown>,
): MutationPlan | WriteRefusal {
  const blank: WritableTask = {
    remoteNodeId: content.remoteNodeId,
    remoteKind: content.remoteKind,
    remoteVersion: content.remoteVersion,
    title: String(data.title ?? ''),
    description: (data.description as string | null) ?? '',
    completed: false,
    closedReason: null,
    statusRole: null,
    priority: 0,
    dueDateTime: null,
  }
  const fields: Record<string, unknown> = {}
  for (const key of ['statusRole', 'priority', 'dueDateTime', 'completed', 'closedReason'] as const) {
    if (key in data) fields[key] = data[key]
  }
  return planRemoteUpdate(blank, [membership], fields)
}
