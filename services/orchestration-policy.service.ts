/**
 * Reading and storing the orchestration policy (AWTD-1693).
 *
 * A project stores a `PolicyOverride` (Project.orchestrationPolicy) and each list may store another
 * (TaskList.orchestrationPolicy). The effective policy for a list is astrid-core's
 * `orchestrationPolicy` over the two, as stored (lib/core-rules/orchestration-core.ts). Nothing
 * stored is the core's default, which is today's behaviour.
 *
 * Shared by the v1 routes (app/api/v1/{lists,projects}/[id]/orchestration-policy) so each route
 * keeps only its auth and envelope.
 *
 * Who may do what:
 * - **Read a list's policy:** anyone with an explicit role on the list (`hasExplicitListRole`),
 *   agents included, since they are list members. A passer-by on a public list is refused: the
 *   policy names the people questions go to.
 * - **Edit a list's override:** `canEditListSettings` (owners and admins, project admins included).
 * - **Read a project's policy:** its owner and members. **Edit it:** `canUserManageProject`.
 * - **People named under `escalation`** must be able to see the board: on a list, its members; on
 *   a project, its owner, its members and the members of its lists. A question handed back to
 *   someone who cannot open the task would reach nobody.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  canEditListSettings,
  canUserManageProject,
  getUserRoleInProject,
  hasExplicitListRole,
  PROJECT_ACCESS_INCLUDE,
} from '@/lib/list-permissions'
import { getListMemberIds } from '@/lib/list-member-utils'
import {
  effectiveOrchestrationPolicy,
  orchestrationEngine,
  orchestrationEscalate,
  orchestrationMay,
  orchestrationRoute,
} from '@/lib/core-rules/orchestration-core'
import {
  defaultOrchestrationPolicy,
  parsePolicyOverride,
  type MayAnswer,
  type MigrationKind,
  type OrchestrationAction,
  type OrchestrationPolicy,
  type PolicyOverride,
  type RouteAnswer,
} from '@/lib/orchestration-policy'

const log = createLogger('orchestration-policy')

export type PolicyResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export interface ListOrchestrationPolicyView {
  listId: string
  projectId: string | null
  /** The list's own override, as stored (null: inherits everything). */
  list: PolicyOverride | null
  /** The project's override, as stored (null: the default, or no project). */
  project: PolicyOverride | null
  /** What agents on this list run under. */
  effective: OrchestrationPolicy
  /** Which engine resolved it: `core`, or `typescript` when the mirror had to answer (fail-safe). */
  engine: 'core' | 'typescript'
  canEdit: { list: boolean; project: boolean }
}

export interface ProjectOrchestrationPolicyView {
  projectId: string
  project: PolicyOverride | null
  /** The project's policy over the default, before any list's override. */
  effective: OrchestrationPolicy
  engine: 'core' | 'typescript'
  canEdit: boolean
}

const MEMBER_USER = { select: { userId: true, role: true, user: { select: { id: true, email: true, name: true } } } } as const

const LIST_SELECT = {
  id: true,
  ownerId: true,
  privacy: true,
  publicListType: true,
  listType: true,
  isVirtual: true,
  projectId: true,
  orchestrationPolicy: true,
  listMembers: MEMBER_USER,
  project: {
    select: {
      ...PROJECT_ACCESS_INCLUDE.project.select,
      orchestrationPolicy: true,
    },
  },
} as const

/** A stored value as an override. A row the rules refuse is logged and read as nothing stored. */
function storedOverride(value: unknown, where: string): PolicyOverride | null {
  const parsed = parsePolicyOverride(value)
  if (parsed.ok) return parsed.value
  log.error({ where, message: parsed.error.message }, 'Stored orchestration policy is not valid; reading it as nothing stored')
  return null
}

/** Fails closed: if the rules cannot resolve, agents get the default, where every action needs a person. */
function resolve(project: PolicyOverride | null, list: PolicyOverride | null): OrchestrationPolicy {
  const answer = effectiveOrchestrationPolicy({ project, list })
  if (answer.ok) return answer.value
  log.error({ message: answer.error.message }, 'Orchestration policy did not resolve; using the default')
  return defaultOrchestrationPolicy()
}

/** The body's `policy`, validated: an override, or null to clear it. */
function submitted(body: unknown): PolicyResult<PolicyOverride | null> {
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'policy')) {
    return { ok: false, status: 400, error: 'Send { policy }: an orchestration policy override, or null to clear it' }
  }
  const parsed = parsePolicyOverride((body as { policy: unknown }).policy)
  if (!parsed.ok) return { ok: false, status: 400, error: `Invalid orchestration policy: ${parsed.error.message}` }
  return { ok: true, value: parsed.value }
}

function strangers(override: PolicyOverride | null, people: Iterable<string>): string[] {
  const escalation = override?.escalation
  if (escalation?.to !== 'people') return []
  const known = new Set(people)
  return escalation.userIds.filter(id => !known.has(id.trim()))
}

/** `null` clears the column (SQL NULL: nothing stored), never a stored JSON `null`. */
const asJson = (override: PolicyOverride | null) =>
  override ? (override as unknown as Prisma.InputJsonValue) : Prisma.DbNull

type LoadedList = NonNullable<Awaited<ReturnType<typeof loadList>>>

function loadList(listId: string) {
  return prisma.taskList.findUnique({ where: { id: listId }, select: LIST_SELECT })
}

function listView(list: LoadedList, userId: string): ListOrchestrationPolicyView {
  const projectOverride = list.project ? storedOverride(list.project.orchestrationPolicy, `project ${list.project.id}`) : null
  const listOverride = storedOverride(list.orchestrationPolicy, `list ${list.id}`)
  return {
    listId: list.id,
    projectId: list.projectId ?? null,
    list: listOverride,
    project: projectOverride,
    effective: resolve(projectOverride, listOverride),
    engine: orchestrationEngine(),
    canEdit: {
      list: canEditListSettings(list as never, userId),
      project: list.project ? canUserManageProject({ id: userId }, list.project as never) : false,
    },
  }
}

export async function getListOrchestrationPolicy(listId: string, userId: string): Promise<PolicyResult<ListOrchestrationPolicyView>> {
  const list = await loadList(listId)
  // 404 rather than 403 for a list the caller has no part in, so the route does not confirm it exists.
  if (!list || !hasExplicitListRole({ id: userId }, list as never)) return { ok: false, status: 404, error: 'List not found' }
  return { ok: true, value: listView(list, userId) }
}

export async function setListOrchestrationPolicy(
  listId: string,
  userId: string,
  body: unknown,
): Promise<PolicyResult<ListOrchestrationPolicyView>> {
  const list = await loadList(listId)
  if (!list || !hasExplicitListRole({ id: userId }, list as never)) return { ok: false, status: 404, error: 'List not found' }
  if (!canEditListSettings(list as never, userId)) {
    return { ok: false, status: 403, error: 'Only the list owner or an admin can change its orchestration policy' }
  }
  const policy = submitted(body)
  if (!policy.ok) return policy
  const unknown = strangers(policy.value, getListMemberIds(list as never))
  if (unknown.length) {
    return { ok: false, status: 400, error: `Questions can only go to people on this list; not on it: ${unknown.join(', ')}` }
  }
  await prisma.taskList.update({ where: { id: listId }, data: { orchestrationPolicy: asJson(policy.value) } })
  return { ok: true, value: listView({ ...list, orchestrationPolicy: policy.value as Prisma.JsonValue }, userId) }
}

// ── Enforcement where agents act (ADEV-36) ───────────────────────────────────

const ENFORCEMENT_SELECT = {
  id: true,
  projectId: true,
  orchestrationPolicy: true,
  project: { select: { orchestrationPolicy: true } },
} as const

/** The overrides as stored for a list, or null for a list that does not exist. */
async function storedFor(listId: string) {
  const list = await prisma.taskList.findUnique({ where: { id: listId }, select: ENFORCEMENT_SELECT })
  if (!list) return null
  return {
    project: list.project ? storedOverride(list.project.orchestrationPolicy, `project ${list.projectId}`) : null,
    list: storedOverride(list.orchestrationPolicy, `list ${list.id}`),
  }
}

const ALLOW: RouteAnswer = { take: true, reason: 'anyAdmittedAgent' }

/**
 * May `mailbox` take an unassigned Ready task on this list? Asked of the core. A list that cannot be
 * read, or a rules refusal, is the default (any agent), which is what nothing stored means.
 */
export async function agentMayTakeUnassigned(listId: string, mailbox: string): Promise<RouteAnswer> {
  const stored = await storedFor(listId)
  if (!stored) return ALLOW
  const answer = orchestrationRoute(stored, mailbox)
  if (answer.ok) return answer.value
  log.error({ listId, message: answer.error.message }, 'Orchestration route did not resolve; allowing the default')
  return ALLOW
}

const ROUTING_MESSAGES: Record<string, string> = {
  routedElsewhere: "This board's orchestration policy sends its unassigned Ready tasks to another agent.",
  notAdmitted: "This board's orchestration policy does not admit this agent.",
}

/**
 * The board's orchestration policy says this agent may not take unassigned work. Every list the
 * task is on is asked, and one refusal is enough. Nothing stored admits any agent.
 */
export async function routingRefusal(taskId: string, mailbox: string): Promise<{ reason: string; message: string } | null> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { lists: { select: { id: true } } } })
  for (const list of task?.lists ?? []) {
    const route = await agentMayTakeUnassigned(list.id, mailbox)
    if (!route.take) return { reason: route.reason, message: ROUTING_MESSAGES[route.reason] ?? 'Refused by orchestration policy.' }
  }
  return null
}

const ACTIONS_REPORTED = ['merge', 'deploy', 'release', 'spend'] as const

export interface AgentListPolicyView {
  listId: string
  /** What agents on this list run under, field by field. */
  effective: OrchestrationPolicy
  /** May the asking agent take an unassigned Ready task here? */
  route: RouteAnswer
  /** What the asking agent may do alone: `allowed`, `ask` (its question goes to `escalation`) or `never`. */
  may: Record<'merge' | 'deploy' | 'release' | 'spend' | 'migrateAdditive' | 'migrateDestructive', MayAnswer>
  /** Who receives a question about a task on this list, in order. */
  escalation: { to: string; notify: string[] }
  engine: 'core' | 'typescript'
}

/** The policy as one agent sees it, for get_agent_queue. Null when the list is unknown. */
export async function listPolicyForAgent(listId: string, mailbox: string, viewerId?: string): Promise<AgentListPolicyView | null> {
  const list = await loadList(listId)
  // The policy names the people questions go to, so a viewer with no role on the list gets none.
  if (!list || (viewerId && !hasExplicitListRole({ id: viewerId }, list as never))) return null
  const stored = {
    project: list.project ? storedOverride(list.project.orchestrationPolicy, `project ${list.projectId}`) : null,
    list: storedOverride(list.orchestrationPolicy, `list ${list.id}`),
  }
  const effective = resolve(stored.project, stored.list)
  const may = (action: OrchestrationAction, migration?: MigrationKind): MayAnswer => {
    const answer = orchestrationMay(stored, mailbox, action, migration)
    return answer.ok ? answer.value : { decision: 'never', mustAsk: false, reason: 'policy' }
  }
  const route = orchestrationRoute(stored, mailbox)
  const escalate = orchestrationEscalate(stored, list.ownerId ?? '')
  return {
    listId: list.id,
    effective,
    route: route.ok ? route.value : { take: false, reason: 'notAdmitted' },
    may: {
      ...(Object.fromEntries(ACTIONS_REPORTED.map(action => [action, may(action)])) as Record<(typeof ACTIONS_REPORTED)[number], MayAnswer>),
      migrateAdditive: may('migrate', 'additive'),
      migrateDestructive: may('migrate', 'destructive'),
    },
    escalation: { to: effective.escalation.to, notify: escalate.ok ? escalate.value.notify : [] },
    engine: orchestrationEngine(),
  }
}

/**
 * What an agent may do alone on a list, for the paths the server owns. `never` is refused with its
 * reason; `ask` is a question to `notify`, and the action waits for the answer.
 */
export async function agentMayOnList(
  listId: string,
  mailbox: string,
  action: OrchestrationAction,
  migration?: MigrationKind | null,
): Promise<MayAnswer & { notify: string[] }> {
  const stored = await storedFor(listId)
  const answer = stored ? orchestrationMay(stored, mailbox, action, migration) : null
  // Fails closed: an action the rules cannot answer needs a person, as the default says.
  const may: MayAnswer = answer?.ok ? answer.value : { decision: 'never', mustAsk: false, reason: 'policy' }
  const owner = await prisma.taskList.findUnique({ where: { id: listId }, select: { ownerId: true } })
  const escalation = stored && owner ? orchestrationEscalate(stored, owner.ownerId) : null
  return { ...may, notify: escalation?.ok ? escalation.value.notify : [] }
}

const PROJECT_SELECT = {
  id: true,
  ownerId: true,
  orchestrationPolicy: true,
  members: { select: { userId: true, role: true } },
  lists: { select: { ownerId: true, listMembers: { select: { userId: true } } } },
} as const

type LoadedProject = NonNullable<Awaited<ReturnType<typeof loadProject>>>

function loadProject(projectId: string) {
  return prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT })
}

function projectView(project: LoadedProject, userId: string): ProjectOrchestrationPolicyView {
  const override = storedOverride(project.orchestrationPolicy, `project ${project.id}`)
  return {
    projectId: project.id,
    project: override,
    effective: resolve(override, null),
    engine: orchestrationEngine(),
    canEdit: canUserManageProject({ id: userId }, project),
  }
}

/** Everyone who can see some board in the project: its owner, its members, and its lists' people. */
function projectPeople(project: LoadedProject): Set<string> {
  const people = new Set<string>([project.ownerId, ...project.members.map(member => member.userId)])
  for (const list of project.lists) {
    people.add(list.ownerId)
    for (const member of list.listMembers) people.add(member.userId)
  }
  return people
}

export async function getProjectOrchestrationPolicy(projectId: string, userId: string): Promise<PolicyResult<ProjectOrchestrationPolicyView>> {
  const project = await loadProject(projectId)
  if (!project || !getUserRoleInProject({ id: userId }, project)) return { ok: false, status: 404, error: 'Project not found' }
  return { ok: true, value: projectView(project, userId) }
}

export async function setProjectOrchestrationPolicy(
  projectId: string,
  userId: string,
  body: unknown,
): Promise<PolicyResult<ProjectOrchestrationPolicyView>> {
  const project = await loadProject(projectId)
  if (!project || !getUserRoleInProject({ id: userId }, project)) return { ok: false, status: 404, error: 'Project not found' }
  if (!canUserManageProject({ id: userId }, project)) {
    return { ok: false, status: 403, error: 'Only the project owner or an admin can change its orchestration policy' }
  }
  const policy = submitted(body)
  if (!policy.ok) return policy
  const unknown = strangers(policy.value, projectPeople(project))
  if (unknown.length) {
    return { ok: false, status: 400, error: `Questions can only go to people on this project's boards; not on them: ${unknown.join(', ')}` }
  }
  await prisma.project.update({ where: { id: projectId }, data: { orchestrationPolicy: asJson(policy.value) } })
  return { ok: true, value: projectView({ ...project, orchestrationPolicy: policy.value as Prisma.JsonValue }, userId) }
}
