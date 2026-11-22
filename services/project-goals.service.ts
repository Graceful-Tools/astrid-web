/**
 * Reading and storing a project's goals and guardrails (ADEV-179).
 *
 * Shared by app/api/v1/projects/[id]/goals, app/api/v1/lists/[id]/goals, the agent payloads and the
 * agent queue, so each keeps only its own envelope. The shape and its rules are lib/goals-guardrails.ts.
 *
 * Who may do what:
 * - **Read:** everyone working in the project: its owner, its members, and anyone with an explicit
 *   role on one of its lists (agents included, since they are list members). The goals exist to be
 *   read by whoever does the work.
 * - **Write:** the project's owner or an admin (`canUserManageProject`), never an agent. Guardrails
 *   bound what agents do, so an agent cannot rewrite its own. An agent that infers goals proposes
 *   them to a person (a Decision), who saves them.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canUserManageProject, getUserRoleInProject, hasExplicitListRole, PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'
import { getListMemberIds } from '@/lib/list-member-utils'
import {
  EMPTY_GOALS_AND_GUARDRAILS,
  hasGoalsOrGuardrails,
  parseGoalsAndGuardrails,
  goalIdsServed,
  storedGoalsAndGuardrails,
  withMeasurement,
  type GoalsAndGuardrails,
  type ProjectGoal,
} from '@/lib/goals-guardrails'

export type GoalsResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export interface ProjectGoalsView {
  projectId: string
  projectName: string
  goals: GoalsAndGuardrails['goals']
  guardrails: GoalsAndGuardrails['guardrails']
  canEdit: boolean
  /** Tasks whose work report named each goal (`GOAL: <id>`, ADEV-182): `{ [goalId]: taskCount }`. */
  workByGoal?: Record<string, number>
}

export interface ListGoalsView extends Omit<ProjectGoalsView, 'projectId' | 'projectName'> {
  listId: string
  /** Null when the list is in no project: then there is nothing stated, and nothing to edit. */
  projectId: string | null
  projectName: string | null
}

const PROJECT_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  goalsAndGuardrails: true,
  members: { select: { userId: true, role: true } },
  lists: { select: { id: true, ownerId: true, listMembers: { select: { userId: true } } } },
} as const

type LoadedProject = NonNullable<Awaited<ReturnType<typeof loadProject>>>

function loadProject(projectId: string) {
  return prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT })
}

/** The project's owner and members, and the people on its lists. */
function worksInProject(project: LoadedProject, userId: string): boolean {
  if (getUserRoleInProject({ id: userId }, project)) return true
  return project.lists.some(list => getListMemberIds(list as never).includes(userId))
}

function projectView(project: LoadedProject, userId: string, value?: GoalsAndGuardrails): ProjectGoalsView {
  const stated = value ?? storedGoalsAndGuardrails(project.goalsAndGuardrails)
  return {
    projectId: project.id,
    projectName: project.name,
    goals: stated.goals,
    guardrails: stated.guardrails,
    canEdit: canUserManageProject({ id: userId }, project),
  }
}

/**
 * How many tasks of the project's lists reported serving each goal. A report is a comment with a
 * `GOAL: <id>` line; a task counts once per goal however many comments name it.
 */
async function workByGoal(projectId: string, goalIds: string[]): Promise<Record<string, number>> {
  if (!goalIds.length) return {}
  const comments = await prisma.comment.findMany({
    where: { content: { contains: 'GOAL:' }, task: { lists: { some: { projectId } } } },
    select: { taskId: true, content: true },
    take: 2000,
  })
  const tasksByGoal = new Map<string, Set<string>>()
  for (const comment of comments) {
    for (const id of goalIdsServed(comment.content)) {
      if (!goalIds.includes(id)) continue
      if (!tasksByGoal.has(id)) tasksByGoal.set(id, new Set())
      tasksByGoal.get(id)!.add(comment.taskId)
    }
  }
  return Object.fromEntries([...tasksByGoal].map(([id, tasks]) => [id, tasks.size]))
}

export async function getProjectGoals(projectId: string, userId: string): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  // 404 rather than 403 for a project the caller has no part in, so the route does not confirm it exists.
  if (!project || !worksInProject(project, userId)) return { ok: false, status: 404, error: 'Project not found' }
  const view = projectView(project, userId)
  return { ok: true, value: { ...view, workByGoal: await workByGoal(projectId, view.goals.map(g => g.id)) } }
}

/**
 * Record a goal's new `current` value (ADEV-182). Unlike the statement itself, this is open to
 * everyone working in the project, agents and scripts included: moving the number is the point of
 * the work, and each change keeps who and when (and the task, if given) in the goal's history.
 * `by` is the agent mailbox or user id the change is signed with.
 */
export async function recordGoalMeasurement(
  projectId: string,
  userId: string,
  goalId: string,
  body: unknown,
  by: string,
): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  if (!project || !worksInProject(project, userId)) return { ok: false, status: 404, error: 'Project not found' }
  const input = (body && typeof body === 'object' ? body : {}) as { current?: unknown; taskId?: unknown }
  if (typeof input.current !== 'string' || !input.current.trim()) return { ok: false, status: 400, error: 'Send { current: "<value>" }' }
  const taskId = typeof input.taskId === 'string' && input.taskId.trim() ? input.taskId.trim() : undefined
  const stored = storedGoalsAndGuardrails(project.goalsAndGuardrails)
  if (!stored.goals.some(g => g.id === goalId)) return { ok: false, status: 404, error: 'Goal not found' }
  const value: GoalsAndGuardrails = {
    ...stored,
    goals: stored.goals.map(g => (g.id === goalId ? withMeasurement(g, input.current as string, by, new Date(), taskId) : g)),
  }
  await prisma.project.update({ where: { id: projectId }, data: { goalsAndGuardrails: value as unknown as Prisma.InputJsonValue } })
  return { ok: true, value: projectView(project, userId, value) }
}

/** `{ goals, guardrails }` replaces what is stored; both empty (or `null`) clears it. */
export async function setProjectGoals(projectId: string, userId: string, body: unknown): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  if (!project || !worksInProject(project, userId)) return { ok: false, status: 404, error: 'Project not found' }
  if (!canUserManageProject({ id: userId }, project)) {
    return { ok: false, status: 403, error: 'Only the project owner or an admin can change its goals and guardrails' }
  }
  if (body === undefined || (body !== null && (typeof body !== 'object' || Array.isArray(body)))) {
    return { ok: false, status: 400, error: 'Send { goals, guardrails }, or null to clear them' }
  }
  const parsed = parseGoalsAndGuardrails(body)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  // History is the server's: carry over what is stored, and record a `current` the editor changed.
  const stored = storedGoalsAndGuardrails(project.goalsAndGuardrails)
  const now = new Date()
  const value: GoalsAndGuardrails = {
    ...parsed.value,
    goals: parsed.value.goals.map(goal => {
      const before = stored.goals.find(g => g.id === goal.id)
      const { history: _submitted, ...rest } = goal
      const kept: ProjectGoal = before?.history ? { ...rest, history: before.history } : rest
      return goal.current && goal.current !== before?.current ? withMeasurement({ ...kept, current: before?.current }, goal.current, userId, now) : kept
    }),
  }
  await prisma.project.update({
    where: { id: projectId },
    // Nothing stated is SQL NULL, never a stored empty object.
    data: { goalsAndGuardrails: hasGoalsOrGuardrails(value) ? (value as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  })
  return { ok: true, value: projectView(project, userId, value) }
}

const LIST_SELECT = {
  id: true,
  ownerId: true,
  privacy: true,
  publicListType: true,
  listType: true,
  isVirtual: true,
  projectId: true,
  listMembers: { select: { userId: true, role: true } },
  project: {
    select: {
      ...PROJECT_ACCESS_INCLUDE.project.select,
      name: true,
      goalsAndGuardrails: true,
    },
  },
} as const

/** The goals of the project a list is in, for anyone with a role on the list. */
export async function getListGoals(listId: string, userId: string): Promise<GoalsResult<ListGoalsView>> {
  const list = await prisma.taskList.findUnique({ where: { id: listId }, select: LIST_SELECT })
  if (!list || !hasExplicitListRole({ id: userId }, list as never)) return { ok: false, status: 404, error: 'List not found' }
  const stated = list.project ? storedGoalsAndGuardrails(list.project.goalsAndGuardrails) : EMPTY_GOALS_AND_GUARDRAILS
  return {
    ok: true,
    value: {
      listId: list.id,
      projectId: list.project?.id ?? null,
      projectName: list.project?.name ?? null,
      goals: stated.goals,
      guardrails: stated.guardrails,
      canEdit: list.project ? canUserManageProject({ id: userId }, list.project as never) : false,
    },
  }
}

export interface ProjectGoalsForAgent {
  projectId: string
  projectName: string
  value: GoalsAndGuardrails
  /** Which of the asked-for lists are in this project, in the order asked (ADEV-190). */
  listIds: string[]
}

/**
 * The stated goals of the projects these lists are in, one entry per project, for agent payloads.
 * Projects with nothing stated are left out. The caller has already decided the agent may see the
 * lists (they hold its tasks), so this does no permission check of its own.
 */
export async function goalsForLists(listIds: string[]): Promise<ProjectGoalsForAgent[]> {
  const ids = [...new Set(listIds.filter(Boolean))]
  if (!ids.length) return []
  const lists = await prisma.taskList.findMany({
    where: { id: { in: ids }, projectId: { not: null } },
    select: { id: true, project: { select: { id: true, name: true, goalsAndGuardrails: true } } },
  })
  const projectOfList = new Map(lists.map(list => [list.id, list.project]))
  const byProject = new Map<string, ProjectGoalsForAgent>()
  for (const listId of ids) {
    const project = projectOfList.get(listId)
    if (!project) continue
    const known = byProject.get(project.id)
    if (known) {
      known.listIds.push(listId)
      continue
    }
    const value = storedGoalsAndGuardrails(project.goalsAndGuardrails)
    if (hasGoalsOrGuardrails(value)) byProject.set(project.id, { projectId: project.id, projectName: project.name, value, listIds: [listId] })
  }
  return [...byProject.values()]
}
