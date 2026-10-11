/**
 * Hydration: reading current state from GitHub (AWTD-1150, P4b).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.7, §13.3. A webhook payload
 * is a trigger, never data — `projects_v2_item` carries ids, not values — so
 * every event hydrates the item it names, and the initial import pages the
 * whole project. Both read through ONE fixed fragment, so P4a's apply sees the
 * same shape whichever way an item arrived, and so the query's cost is fixed.
 *
 * Every query also asks for `rateLimit { cost remaining resetAt }`, which the
 * rate limiter charges to the installation's bucket (§8.8).
 */

import type { RemoteProjectItem } from './apply'
import type { GraphqlClient } from '../rate-limiter'

/** Field values read per item. Status, Priority, a date and a few custom fields fit easily. */
const FIELD_VALUES_PER_ITEM = 20

/**
 * Blockers read per issue (AWTD-1119). An issue with more reports a larger
 * totalCount, and its list is then added to but never pruned (relations.ts).
 */
const BLOCKERS_PER_ISSUE = 20

/** GitHub's maximum page size for project items. */
export const ITEMS_PAGE_SIZE = 100

/**
 * The one item fragment (§13.3). Its shape is RemoteProjectItem; change them
 * together, and re-record tests/fixtures/github/graphql when you do.
 */
export const PROJECT_ITEM_FRAGMENT = /* GraphQL */ `
fragment ProjectItemFields on ProjectV2Item {
  id
  isArchived
  type
  updatedAt
  content {
    __typename
    ... on DraftIssue { id title body updatedAt }
    ... on Issue {
      id title body updatedAt number url state stateReason
      repository { nameWithOwner }
      parent { id }
      blockedBy(first: ${BLOCKERS_PER_ISSUE}) { totalCount nodes { id } }
    }
    ... on PullRequest {
      id title body updatedAt number url state
      repository { nameWithOwner }
    }
  }
  fieldValues(first: ${FIELD_VALUES_PER_ITEM}) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ... on ProjectV2FieldCommon { id } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
    }
  }
}`

const RATE_LIMIT = 'rateLimit { cost remaining resetAt }'

export const HYDRATE_ITEM_QUERY = /* GraphQL */ `
query HydrateProjectItem($id: ID!) {
  node(id: $id) { ...ProjectItemFields }
  ${RATE_LIMIT}
}
${PROJECT_ITEM_FRAGMENT}`

export const PROJECT_ITEMS_PAGE_QUERY = /* GraphQL */ `
query ProjectItemsPage($id: ID!, $after: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: ${ITEMS_PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ...ProjectItemFields }
      }
    }
  }
  ${RATE_LIMIT}
}
${PROJECT_ITEM_FRAGMENT}`

/**
 * One item's current state, or null when GitHub no longer has it (deleted, or
 * the installation lost access) — which the caller treats as "leave the list".
 */
export async function hydrateItem(client: GraphqlClient, itemNodeId: string): Promise<RemoteProjectItem | null> {
  const data = await client.query<{ node: RemoteProjectItem | null }>(HYDRATE_ITEM_QUERY, { id: itemNodeId })
  // node(id:) on an id of another type resolves to {} — not an item.
  return data.node && 'fieldValues' in data.node ? data.node : null
}

export interface ProjectItemsPage {
  items: RemoteProjectItem[]
  nextCursor: string | null
}

/** One page of a project's items (≤ 100), for the initial import and reconcile. */
export async function fetchProjectItemsPage(
  client: GraphqlClient,
  projectNodeId: string,
  after: string | null = null,
): Promise<ProjectItemsPage> {
  const data = await client.query<{
    node: { items?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RemoteProjectItem[] } } | null
  }>(PROJECT_ITEMS_PAGE_QUERY, { id: projectNodeId, after })
  const items = data.node?.items
  if (!items) throw new Error(`GitHub project ${projectNodeId} not found or not readable by this installation`)
  return {
    items: items.nodes,
    nextCursor: items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null,
  }
}

/** Every item in a project, page by page. The import batches its writes per page (§13.3). */
export async function* projectItemPages(client: GraphqlClient, projectNodeId: string): AsyncGenerator<RemoteProjectItem[]> {
  let after: string | null = null
  do {
    const page: ProjectItemsPage = await fetchProjectItemsPage(client, projectNodeId, after)
    yield page.items
    after = page.nextCursor
  } while (after)
}
