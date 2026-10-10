/**
 * Binding a GitHub Project to an Astrid board (AWTD-1151, P4c).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4, §9.2, §11.2. The bind
 * wizard lists an org's projects, reads the chosen project's fields, and
 * PROPOSES a mapping the user confirms:
 *
 *   Status       Todo → ready · In Progress → doing · Blocked/Waiting →
 *                waiting · Done → done · anything else → custom gh:<optionId>
 *   Priority     a single-select named Priority; options in order → 3, 2, 1, 0
 *   Due          the first Date field named like due / target / deadline
 *   Estimate     a Number field named Estimate (kept for P6a)
 *
 * The proposal is pure, so every naming rule is a table test.
 */

import type { GraphqlClient } from '../rate-limiter'
import type { BindingFieldMap } from './apply'
import { DONE_OPTION } from './apply'
import type { StatusState } from '@/lib/task-status'

export const PROJECT_SCHEMA_QUERY = /* GraphQL */ `
query ProjectSchema($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      id number title url closed
      owner { __typename ... on Organization { login databaseId } ... on User { login databaseId } }
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name } }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`

export const ORG_PROJECTS_QUERY = /* GraphQL */ `
query OrgProjects($login: String!) {
  organization(login: $login) {
    projectsV2(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { id number title url closed updatedAt items { totalCount } }
    }
  }
  rateLimit { cost remaining resetAt }
}`

export interface ProjectSchemaField {
  __typename: string
  id?: string
  name?: string
  dataType?: string
  options?: Array<{ id: string; name: string }>
}

export interface ProjectSchema {
  id: string
  number: number
  title: string
  url: string
  closed: boolean
  owner: { __typename: 'Organization' | 'User'; login: string; databaseId: number }
  fields: { nodes: ProjectSchemaField[] }
}

export interface OrgProject {
  id: string
  number: number
  title: string
  url: string
  closed: boolean
  updatedAt: string
  items: { totalCount: number }
}

export interface BindingProposal extends BindingFieldMap {
  estimateFieldId: string | null
  /** Board columns for Status options that are not one of the defaults. */
  customStates: StatusState[]
}

const STATUS_BY_NAME: Array<[RegExp, string]> = [
  [/^(todo|to do|ready|backlog)$/i, 'ready'],
  [/^(in progress|doing|in review|review)$/i, 'doing'],
  [/^(blocked|waiting|on hold)$/i, 'waiting'],
  [/^(done|complete|completed|closed|shipped)$/i, DONE_OPTION],
]

const DUE_FIELD_NAME = /\b(due|target|deadline)\b/i

function single(fields: ProjectSchemaField[], name: RegExp): ProjectSchemaField | undefined {
  return fields.find(f => f.dataType === 'SINGLE_SELECT' && f.name && name.test(f.name))
}

/** The custom role for a Status option with no default home. */
export function customRoleFor(optionId: string): string {
  return `gh:${optionId}`
}

export function proposeBinding(schema: Pick<ProjectSchema, 'fields'>): BindingProposal {
  const fields = schema.fields.nodes
  const status = single(fields, /^status$/i)
  // A Priority field with no options (the real test project has one) has
  // nothing to map: the board then has no priority (supports.priority false).
  const priority = [single(fields, /^priority$/i)].find(f => (f?.options?.length ?? 0) > 0)
  const due = fields.find(f => f.dataType === 'DATE' && f.name && DUE_FIELD_NAME.test(f.name))
  const estimate = fields.find(f => f.dataType === 'NUMBER' && f.name && /^estimate$/i.test(f.name))

  const statusOptionMap: Record<string, string> = {}
  const customStates: StatusState[] = []
  const taken = new Set<string>()
  for (const option of status?.options ?? []) {
    const role = STATUS_BY_NAME.find(([pattern]) => pattern.test(option.name.trim()))?.[1]
    // Two options proposing the same default (Todo AND Backlog): the first
    // keeps it, the rest become their own columns rather than merging.
    if (role && (role === DONE_OPTION || !taken.has(role))) {
      statusOptionMap[option.id] = role
      taken.add(role)
    } else {
      statusOptionMap[option.id] = customRoleFor(option.id)
      customStates.push({ role: customRoleFor(option.id), name: option.name, order: customStates.length })
    }
  }

  const options = priority?.options ?? []
  const priorityOptionMap = priority
    ? Object.fromEntries(options.map((option, index) => [option.id, Math.max(0, 3 - index)]))
    : null

  return {
    statusFieldId: status?.id ?? null,
    statusOptionMap,
    priorityFieldId: priority?.id ?? null,
    priorityOptionMap,
    dueFieldId: due?.id ?? null,
    estimateFieldId: estimate?.id ?? null,
    customStates,
  }
}

/** The chosen project's identity and fields; null when this installation cannot read it. */
export async function fetchProjectSchema(client: GraphqlClient, projectNodeId: string): Promise<ProjectSchema | null> {
  const data = await client.query<{ node: Partial<ProjectSchema> | null }>(PROJECT_SCHEMA_QUERY, { id: projectNodeId })
  const node = data.node
  return node && node.fields && node.owner ? (node as ProjectSchema) : null
}

/** An org's projects, most recently updated first. */
export async function fetchOrgProjects(client: GraphqlClient, login: string): Promise<OrgProject[]> {
  const data = await client.query<{ organization: { projectsV2: { nodes: OrgProject[] } } | null }>(ORG_PROJECTS_QUERY, { login })
  return data.organization?.projectsV2.nodes ?? []
}
