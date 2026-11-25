/**
 * Links from tasks and lists to their project's goals (ADEV-271, spec: docs/specs/GOALS_GUARDRAILS_SIGNALS.md).
 *
 * A row per link (`GoalLink`), because a task can sit on lists in different projects and a bare goal
 * id on the task would name nothing. A task's goals are its own links plus the links of its lists in
 * the same project, computed on read; nothing is copied down. A link to a goal id the project no
 * longer states is ignored on read and deleted with the goals write (`setProjectGoals`).
 *
 * Who may link: anyone who can write the task, agents included (the route checks task access).
 * Linking a list needs list admin (`canUserManageList`). Reading a list's links needs a role on it.
 */
import { prisma } from '@/lib/prisma'
import { canUserManageList, hasExplicitListRole } from '@/lib/list-permissions'
import { goalIdsServed, storedGoalsAndGuardrails } from '@/lib/goals-guardrails'

export type GoalLinkSource = 'person' | 'agent' | 'report'
export type GoalLinkResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404; error: string }

export interface GoalLinkView {
  projectId: string
  projectName: string
  goalId: string
  statement: string
  /** `task`: linked on the task itself. `list`: inherited from `listId`. */
  via: 'task' | 'list'
  listId?: string
  source: GoalLinkSource
}

export interface TaskGoalsView {
  taskId: string
  links: GoalLinkView[]
}

export interface ListGoalLinksView {
  listId: string
  projectId: string | null
  links: GoalLinkView[]
}

const PROJECT_GOALS_SELECT = { id: true, name: true, goalsAndGuardrails: true } as const

function statedGoals(project: { goalsAndGuardrails: unknown }) {
  return storedGoalsAndGuardrails(project.goalsAndGuardrails as never).goals
}

/** Pull `{ goalIds: string[] }` (or one `goalId`) out of a PUT/DELETE body. */
export function parseGoalIds(body: unknown): { goalIds: string[]; projectId?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const input = body as { goalIds?: unknown; goalId?: unknown; projectId?: unknown }
  const raw = Array.isArray(input.goalIds) ? input.goalIds : typeof input.goalId === 'string' ? [input.goalId] : null
  if (!raw || raw.some(id => typeof id !== 'string' || !id.trim())) return null
  const projectId = typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : undefined
  return { goalIds: [...new Set((raw as string[]).map(id => id.trim()))], projectId }
}

async function loadTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, lists: { select: { id: true, projectId: true, project: { select: PROJECT_GOALS_SELECT } } } },
  })
}

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>

function projectsOf(task: LoadedTask) {
  const projects = new Map<string, NonNullable<LoadedTask['lists'][number]['project']>>()
  for (const list of task.lists) if (list.project) projects.set(list.project.id, list.project)
  return projects
}

/** The task's own links plus its lists' links, for goals each project still states. */
export async function getTaskGoals(taskId: string): Promise<GoalLinkResult<TaskGoalsView>> {
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const projects = projectsOf(task)
  if (!projects.size) return { ok: true, value: { taskId, links: [] } }
  const listIds = task.lists.filter(l => l.projectId).map(l => l.id)
  const rows = await prisma.goalLink.findMany({
    where: { projectId: { in: [...projects.keys()] }, OR: [{ taskId }, { listId: { in: listIds } }] },
    orderBy: { createdAt: 'asc' },
  })
  const links: GoalLinkView[] = []
  for (const row of rows) {
    const project = projects.get(row.projectId)
    const goal = project && statedGoals(project).find(g => g.id === row.goalId)
    if (!project || !goal) continue
    links.push({
      projectId: project.id,
      projectName: project.name,
      goalId: goal.id,
      statement: goal.statement,
      via: row.taskId ? 'task' : 'list',
      ...(row.listId ? { listId: row.listId } : {}),
      source: row.source as GoalLinkSource,
    })
  }
  return { ok: true, value: { taskId, links } }
}

/** Which project the body means: the named one, else the task's only one. */
function chooseProject<P extends { id: string }>(projects: Map<string, P>, projectId?: string): GoalLinkResult<P> {
  if (projectId) {
    const found = projects.get(projectId)
    return found ? { ok: true, value: found } : { ok: false, status: 404, error: 'Project not found on this task' }
  }
  if (projects.size === 1) return { ok: true, value: [...projects.values()][0] }
  if (!projects.size) return { ok: false, status: 400, error: "The task's lists are in no project" }
  return { ok: false, status: 400, error: "The task is in several projects; send { projectId }" }
}

/** Replace the task's own links in one project with `goalIds` (empty clears them). */
export async function setTaskGoals(
  taskId: string,
  userId: string,
  body: unknown,
  source: GoalLinkSource,
): Promise<GoalLinkResult<TaskGoalsView>> {
  const parsed = parseGoalIds(body)
  if (!parsed) return { ok: false, status: 400, error: 'Send { goalIds: ["g1"], projectId? }' }
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const chosen = chooseProject(projectsOf(task), parsed.projectId)
  if (!chosen.ok) return chosen
  const project = chosen.value
  const stated = new Set(statedGoals(project).map(g => g.id))
  const unknown = parsed.goalIds.filter(id => !stated.has(id))
  if (unknown.length) return { ok: false, status: 400, error: `The project does not state goal ${unknown.join(', ')}` }
  await prisma.$transaction([
    prisma.goalLink.deleteMany({ where: { taskId, projectId: project.id, goalId: { notIn: parsed.goalIds } } }),
    ...parsed.goalIds.map(goalId =>
      prisma.goalLink.upsert({
        where: { taskId_projectId_goalId: { taskId, projectId: project.id, goalId } },
        update: {},
        create: { taskId, projectId: project.id, goalId, source, createdById: userId },
      }),
    ),
  ])
  return getTaskGoals(taskId)
}

/** Remove the task's own links to `goalIds`. Links inherited from a list are the list's to remove. */
export async function removeTaskGoals(taskId: string, body: unknown): Promise<GoalLinkResult<TaskGoalsView>> {
  const parsed = parseGoalIds(body)
  if (!parsed) return { ok: false, status: 400, error: 'Send { goalId } or { goalIds: ["g1"] }' }
  const task = await loadTask(taskId)
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  await prisma.goalLink.deleteMany({
    where: { taskId, goalId: { in: parsed.goalIds }, ...(parsed.projectId ? { projectId: parsed.projectId } : {}) },
  })
  return getTaskGoals(taskId)
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
  project: { select: PROJECT_GOALS_SELECT },
} as const

async function loadReadableList(listId: string, userId: string) {
  const list = await prisma.taskList.findUnique({ where: { id: listId }, select: LIST_SELECT })
  // 404 rather than 403 for a list the caller has no role on, so the route does not confirm it exists.
  if (!list || !hasExplicitListRole({ id: userId }, list as never)) return null
  return list
}

async function listLinksView(list: NonNullable<Awaited<ReturnType<typeof loadReadableList>>>): Promise<ListGoalLinksView> {
  if (!list.project) return { listId: list.id, projectId: null, links: [] }
  const project = list.project
  const goals = statedGoals(project)
  const rows = await prisma.goalLink.findMany({ where: { listId: list.id, projectId: project.id }, orderBy: { createdAt: 'asc' } })
  const links: GoalLinkView[] = []
  for (const row of rows) {
    const goal = goals.find(g => g.id === row.goalId)
    if (!goal) continue
    links.push({
      projectId: project.id,
      projectName: project.name,
      goalId: goal.id,
      statement: goal.statement,
      via: 'list',
      listId: list.id,
      source: row.source as GoalLinkSource,
    })
  }
  return { listId: list.id, projectId: project.id, links }
}

export async function getListGoalLinks(listId: string, userId: string): Promise<GoalLinkResult<ListGoalLinksView>> {
  const list = await loadReadableList(listId, userId)
  if (!list) return { ok: false, status: 404, error: 'List not found' }
  return { ok: true, value: await listLinksView(list) }
}

/** Replace the list's links with `goalIds`. List admins only. */
export async function setListGoalLinks(
  listId: string,
  userId: string,
  body: unknown,
  source: GoalLinkSource,
): Promise<GoalLinkResult<ListGoalLinksView>> {
  const parsed = parseGoalIds(body)
  if (!parsed) return { ok: false, status: 400, error: 'Send { goalIds: ["g1"] }' }
  const list = await loadReadableList(listId, userId)
  if (!list) return { ok: false, status: 404, error: 'List not found' }
  if (!canUserManageList({ id: userId }, list as never)) return { ok: false, status: 403, error: 'Only a list admin can link the list to goals' }
  if (!list.project) return { ok: false, status: 400, error: 'The list is in no project, so there are no goals to link' }
  const projectId = list.project.id
  const stated = new Set(statedGoals(list.project).map(g => g.id))
  const unknown = parsed.goalIds.filter(id => !stated.has(id))
  if (unknown.length) return { ok: false, status: 400, error: `The project does not state goal ${unknown.join(', ')}` }
  await prisma.$transaction([
    prisma.goalLink.deleteMany({ where: { listId, goalId: { notIn: parsed.goalIds } } }),
    ...parsed.goalIds.map(goalId =>
      prisma.goalLink.upsert({
        where: { listId_goalId: { listId, goalId } },
        update: {},
        create: { listId, projectId, goalId, source, createdById: userId },
      }),
    ),
  ])
  return { ok: true, value: await listLinksView(list) }
}

export async function removeListGoalLinks(listId: string, userId: string, body: unknown): Promise<GoalLinkResult<ListGoalLinksView>> {
  const parsed = parseGoalIds(body)
  if (!parsed) return { ok: false, status: 400, error: 'Send { goalId } or { goalIds: ["g1"] }' }
  const list = await loadReadableList(listId, userId)
  if (!list) return { ok: false, status: 404, error: 'List not found' }
  if (!canUserManageList({ id: userId }, list as never)) return { ok: false, status: 403, error: 'Only a list admin can unlink the list from goals' }
  await prisma.goalLink.deleteMany({ where: { listId, goalId: { in: parsed.goalIds } } })
  return { ok: true, value: await listLinksView(list) }
}

/**
 * A work report's `GOAL: g1, g2` line links the task to those goals with `source: "report"` (the
 * comment write path calls this). Only goals a project of the task's lists still states are linked,
 * and a link someone made on purpose is never rewritten. Returns the number of goals linked.
 */
export async function linkGoalsFromReport(taskId: string, content: string, authorId: string): Promise<number> {
  if (!content.includes('GOAL:')) return 0
  const ids = goalIdsServed(content)
  if (!ids.length) return 0
  const task = await loadTask(taskId)
  if (!task) return 0
  const writes = []
  for (const project of projectsOf(task).values()) {
    const stated = new Set(statedGoals(project).map(g => g.id))
    for (const goalId of ids) {
      if (!stated.has(goalId)) continue
      writes.push(
        prisma.goalLink.upsert({
          where: { taskId_projectId_goalId: { taskId, projectId: project.id, goalId } },
          update: {},
          create: { taskId, projectId: project.id, goalId, source: 'report', createdById: authorId },
        }),
      )
    }
  }
  if (writes.length) await prisma.$transaction(writes)
  return writes.length
}
