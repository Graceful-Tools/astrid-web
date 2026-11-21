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
  storedGoalsAndGuardrails,
  type GoalsAndGuardrails,
} from '@/lib/goals-guardrails'

export type GoalsResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export interface ProjectGoalsView {
  projectId: string
  projectName: string
  goals: GoalsAndGuardrails['goals']
  guardrails: GoalsAndGuardrails['guardrails']
  canEdit: boolean
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
 * The project and its stated goals for anyone working in it, or a 404 result (never a 403, so the
 * caller cannot probe which projects exist). Shared with the decisions service (ADEV-180).
 */
export async function loadProjectForMember(
  projectId: string,
  userId: string,
): Promise<GoalsResult<{ project: LoadedProject; stated: GoalsAndGuardrails }>> {
  const project = await loadProject(projectId)
  if (!project || !worksInProject(project, userId)) return { ok: false, status: 404, error: 'Project not found' }
  return { ok: true, value: { project, stated: storedGoalsAndGuardrails(project.goalsAndGuardrails) } }
}

export async function getProjectGoals(projectId: string, userId: string): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  // 404 rather than 403 for a project the caller has no part in, so the route does not confirm it exists.
  if (!project || !worksInProject(project, userId)) return { ok: false, status: 404, error: 'Project not found' }
  return { ok: true, value: projectView(project, userId) }
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
  const value = parsed.value
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
    select: { project: { select: { id: true, name: true, goalsAndGuardrails: true } } },
  })
  const byProject = new Map<string, ProjectGoalsForAgent>()
  for (const { project } of lists) {
    if (!project || byProject.has(project.id)) continue
    const value = storedGoalsAndGuardrails(project.goalsAndGuardrails)
    if (hasGoalsOrGuardrails(value)) byProject.set(project.id, { projectId: project.id, projectName: project.name, value })
  }
  return [...byProject.values()]
}
