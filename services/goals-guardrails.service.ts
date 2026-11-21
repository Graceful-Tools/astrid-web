/**
 * Reading and storing a project's goals and guardrails (ADEV-179).
 *
 * Shared by app/api/v1/projects/[id]/goals and app/api/v1/lists/[id]/goals so each route keeps
 * only its auth and envelope. Shapes and validation live in lib/goals-guardrails.ts.
 *
 * Who may do what, as for the orchestration policy (services/orchestration-policy.service.ts):
 * - **Read a project's goals:** its owner and members. **Edit them:** `canUserManageProject`.
 * - **Read a list's goals** (its project's, for agents and clients that start from a list):
 *   anyone with an explicit role on the list, agents included.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  canUserManageProject,
  getUserRoleInProject,
  hasExplicitListRole,
  PROJECT_ACCESS_INCLUDE,
} from '@/lib/list-permissions'
import { formatGoalsForAgent, parseGoalsAndGuardrails, readStoredGoals, type GoalsAndGuardrails } from '@/lib/goals-guardrails'

export type GoalsResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export interface ProjectGoalsView {
  projectId: string
  /** What the project states, or null when nothing is stated. */
  goals: GoalsAndGuardrails | null
  canEdit: boolean
}

export interface ListGoalsView {
  listId: string
  /** The list's project; null for a list with no project (it states no goals). */
  projectId: string | null
  goals: GoalsAndGuardrails | null
  /** The plain-text block for a prompt (formatGoalsForAgent); empty when nothing is stated. */
  text: string
  canEdit: boolean
}

function loadProject(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { ...PROJECT_ACCESS_INCLUDE.project.select, goalsAndGuardrails: true },
  })
}

export async function getProjectGoals(projectId: string, userId: string): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  if (!project || !getUserRoleInProject({ id: userId }, project as never)) return { ok: false, status: 404, error: 'Project not found' }
  return {
    ok: true,
    value: {
      projectId: project.id,
      goals: readStoredGoals(project.goalsAndGuardrails),
      canEdit: canUserManageProject({ id: userId }, project as never),
    },
  }
}

export async function setProjectGoals(projectId: string, userId: string, body: unknown): Promise<GoalsResult<ProjectGoalsView>> {
  const project = await loadProject(projectId)
  if (!project || !getUserRoleInProject({ id: userId }, project as never)) return { ok: false, status: 404, error: 'Project not found' }
  if (!canUserManageProject({ id: userId }, project as never)) {
    return { ok: false, status: 403, error: 'Only the project owner or an admin can change its goals and guardrails' }
  }
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'goals')) {
    return { ok: false, status: 400, error: 'Send { goals }: the goals and guardrails, or null to clear them' }
  }
  const parsed = parseGoalsAndGuardrails((body as { goals: unknown }).goals)
  if (!parsed.ok) return { ok: false, status: 400, error: `Invalid goals and guardrails: ${parsed.error}` }
  await prisma.project.update({
    where: { id: projectId },
    // `null` clears the column (SQL NULL), never a stored JSON `null`.
    data: { goalsAndGuardrails: parsed.value ? (parsed.value as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
  })
  return { ok: true, value: { projectId, goals: parsed.value, canEdit: true } }
}

export async function getListGoals(listId: string, userId: string): Promise<GoalsResult<ListGoalsView>> {
  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      ownerId: true,
      privacy: true,
      publicListType: true,
      listType: true,
      isVirtual: true,
      projectId: true,
      listMembers: { select: { userId: true, role: true } },
      project: { select: { ...PROJECT_ACCESS_INCLUDE.project.select, goalsAndGuardrails: true } },
    },
  })
  // 404 rather than 403 for a list the caller has no part in, so the route does not confirm it exists.
  if (!list || !hasExplicitListRole({ id: userId }, list as never)) return { ok: false, status: 404, error: 'List not found' }
  const goals = list.project ? readStoredGoals(list.project.goalsAndGuardrails) : null
  return {
    ok: true,
    value: {
      listId: list.id,
      projectId: list.projectId ?? null,
      goals,
      text: formatGoalsForAgent(goals),
      canEdit: list.project ? canUserManageProject({ id: userId }, list.project as never) : false,
    },
  }
}

/** Goals for the lists a task or queue is on, keyed by list id. Lists with none are omitted. */
export async function goalsByListId(listIds: string[]): Promise<Map<string, GoalsAndGuardrails>> {
  const result = new Map<string, GoalsAndGuardrails>()
  if (listIds.length === 0) return result
  const lists = await prisma.taskList.findMany({
    where: { id: { in: listIds } },
    select: { id: true, project: { select: { goalsAndGuardrails: true } } },
  })
  for (const list of lists) {
    const goals = readStoredGoals(list.project?.goalsAndGuardrails)
    if (goals) result.set(list.id, goals)
  }
  return result
}
