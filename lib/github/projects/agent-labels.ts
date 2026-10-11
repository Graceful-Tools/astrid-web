/**
 * An AI agent's assignment, mirrored on GitHub as a label `agent:<name>`
 * (AWTD-1191, P6c-5). Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.6,
 * §15 C3. Pure, like labels.ts:
 *
 *   agentLabelName(agent)             the label that says this agent has it
 *   planAgentLabelLookup(id, wanted)  what to ask GitHub first
 *   planAgentLabelChange(state, …)    labels to create, add and remove
 *
 * An agent is never a GitHub assignee, so without the label nothing on
 * github.com says an agent has the task. Astrid is where an agent is
 * assigned: the label follows the replica and is never read back as an
 * assignment, nor as an ordinary label (labels.ts drops it).
 *
 * The `agent:` prefix is the mirror's own. A label under it for an agent that
 * is not assigned in Astrid is removed; no other label is ever touched.
 *
 * Only when the brand turns on `githubAgentLabels` — off by default, since a
 * label written to a partner's customers' repos is the partner's call.
 */

export const AGENT_LABEL_PREFIX = 'agent:'

/** GitHub's bare hex for a label this mirror creates. */
export const AGENT_LABEL_COLOR = 'ededed'

/** What an `agent_label` sync job carries: the issue, and every label it should have. */
export interface AgentLabelPayload {
  remoteNodeId: string
  labels: string[]
}

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** `agent:<mailbox>`; the agent's name when it has no address. Null when it has neither. */
export function agentLabelName(agent: { email?: string | null; name?: string | null }): string | null {
  const name = slug(agent.email?.split('@')[0] ?? '') || slug(agent.name ?? '')
  return name ? `${AGENT_LABEL_PREFIX}${name}` : null
}

/** GitHub's label names are case-insensitive. */
export function isAgentLabelName(name: string): boolean {
  return name.toLowerCase().startsWith(AGENT_LABEL_PREFIX)
}

export interface AgentLabelDocument {
  document: string
  variables: Record<string, unknown>
}

/** The issue's labels, its repo, and each wanted label as the repo holds it. */
export function planAgentLabelLookup(remoteNodeId: string, wanted: readonly string[]): AgentLabelDocument {
  const params = wanted.map((_, i) => `, $n${i}: String!`).join('')
  const lookups = wanted.map((_, i) => `l${i}: label(name: $n${i}) { id }`).join(' ')
  const fields = `labels(first: 100) { nodes { id name } } repository { id ${lookups} }`
  return {
    document: `query($id: ID!${params}) { node(id: $id) { ... on Issue { ${fields} } ... on PullRequest { ${fields} } } rateLimit { cost remaining resetAt } }`,
    variables: { id: remoteNodeId, ...Object.fromEntries(wanted.map((name, i) => [`n${i}`, name])) },
  }
}

export interface AgentLabelState {
  repositoryId: string
  onIssue: Array<{ id: string; name: string }>
  /** Wanted label name → its node id in the repo, or null when the repo lacks it. */
  inRepo: Record<string, string | null>
}

/** Null when the content is gone or carries no labels: nothing to mirror onto. */
export function parseAgentLabelLookup(result: unknown, wanted: readonly string[]): AgentLabelState | null {
  const node = (result as { node?: { labels?: { nodes: AgentLabelState['onIssue'] }; repository?: Record<string, unknown> } | null })
    ?.node
  const repositoryId = node?.repository?.id
  if (!node?.labels || typeof repositoryId !== 'string') return null
  return {
    repositoryId,
    onIssue: node.labels.nodes,
    inRepo: Object.fromEntries(
      wanted.map((name, i) => [name, (node.repository?.[`l${i}`] as { id?: string } | null | undefined)?.id ?? null]),
    ),
  }
}

export interface AgentLabelChange {
  /** Label names the repo lacks; created, then added. */
  create: string[]
  /** Label node ids to add to the issue. */
  add: string[]
  /** Label node ids to remove from it. */
  remove: string[]
}

export function planAgentLabelChange(state: AgentLabelState, wanted: readonly string[]): AgentLabelChange {
  const want = new Set(wanted.map(name => name.toLowerCase()))
  const has = new Set(state.onIssue.map(label => label.name.toLowerCase()))
  const missing = wanted.filter(name => !has.has(name.toLowerCase()))
  return {
    create: missing.filter(name => !state.inRepo[name]),
    add: missing.flatMap(name => (state.inRepo[name] ? [state.inRepo[name] as string] : [])),
    remove: state.onIssue.filter(label => isAgentLabelName(label.name) && !want.has(label.name.toLowerCase())).map(label => label.id),
  }
}

/** One createLabel per name, aliased c0, c1, … in the order given. */
export function planAgentLabelCreate(repositoryId: string, names: readonly string[], description: string): AgentLabelDocument {
  const params = names.map((_, i) => `, $n${i}: String!`).join('')
  const fields = names
    .map((_, i) => `c${i}: createLabel(input: { repositoryId: $r, name: $n${i}, color: $c, description: $d }) { label { id } }`)
    .join(' ')
  return {
    document: `mutation($r: ID!, $c: String!, $d: String${params}) { ${fields} }`,
    variables: { r: repositoryId, c: AGENT_LABEL_COLOR, d: description, ...Object.fromEntries(names.map((name, i) => [`n${i}`, name])) },
  }
}

/** The ids `planAgentLabelCreate`'s result reports, in the order asked. */
export function createdAgentLabelIds(result: unknown, count: number): string[] {
  const created = (result ?? {}) as Record<string, { label?: { id?: string } } | null>
  return Array.from({ length: count }, (_, i) => created[`c${i}`]?.label?.id).filter((id): id is string => Boolean(id))
}

/** Null when the issue already carries exactly the labels it should. */
export function planAgentLabelWrite(remoteNodeId: string, add: readonly string[], remove: readonly string[]): AgentLabelDocument | null {
  if (add.length === 0 && remove.length === 0) return null
  const fields = [
    ...(remove.length > 0 ? ['m0: removeLabelsFromLabelable(input: { labelableId: $id, labelIds: $remove }) { clientMutationId }'] : []),
    ...(add.length > 0 ? ['m1: addLabelsToLabelable(input: { labelableId: $id, labelIds: $add }) { clientMutationId }'] : []),
  ]
  // GraphQL refuses a declared variable no field uses, so declare only those in play.
  const params = `${remove.length > 0 ? ', $remove: [ID!]!' : ''}${add.length > 0 ? ', $add: [ID!]!' : ''}`
  return {
    document: `mutation($id: ID!${params}) { ${fields.join(' ')} }`,
    variables: { id: remoteNodeId, add: [...add], remove: [...remove] },
  }
}
