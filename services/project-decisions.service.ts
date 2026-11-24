/**
 * A project's decisions (ADEV-180). A decision is a task whose description holds a Decision and a
 * trade-off grid (lib/decision-grid.ts), so it has an id, an assignee, lanes and the agent handoff
 * already. This service starts one from the project's goals, lists the project's open and decided
 * ones with the choice, and records a choice on the task.
 *
 * Who may: anyone working in the project (as for reading its goals). An agent may start and
 * record decisions; it still cannot change the goals and guardrails they are built from.
 */
import { prisma } from '@/lib/prisma'
import { parseDecision } from '@/lib/comment-formats'
import { buildNewDecision, chosenOption, recordDecided, recordedChoice, type ChosenOption } from '@/lib/decision-grid'
import { loadProjectForMember, type GoalsResult } from '@/services/project-goals.service'
import { createTaskWithSideEffects, updateTaskWithSideEffects } from '@/services/task.service'

export interface ProjectDecisionView {
  id: string
  identifier: string | null
  title: string
  /** The question the Decision asks. */
  prompt: string
  options: Array<{ number: number; text: string; recommended: boolean }>
  status: 'open' | 'decided'
  /** The option chosen; null while open. */
  chosen: ChosenOption | null
  assigneeId: string | null
  createdAt: string
}

export interface NewProjectDecision {
  task: { id: string; identifier: string | null; title: string; listIds: string[] }
  criteria: Array<{ letter: string; name: string; goalId: string | null }>
}

const DECISION_TASK_SELECT = {
  id: true,
  identifier: true,
  title: true,
  description: true,
  completed: true,
  assigneeId: true,
  createdAt: true,
  comments: { select: { content: true, authorId: true }, orderBy: { createdAt: 'asc' as const } },
} as const

type FailureStatus = 400 | 403 | 404

function failureStatus(status: number): FailureStatus {
  return status === 403 || status === 404 ? status : 400
}

/** Start a decision from the project's goals, on one of its lists (default: the first). */
export async function createProjectDecision(args: {
  projectId: string
  userId: string
  title?: string
  listId?: string
  assigneeId?: string | null
}): Promise<GoalsResult<NewProjectDecision>> {
  const loaded = await loadProjectForMember(args.projectId, args.userId)
  if (!loaded.ok) return loaded
  const { project, stated } = loaded.value
  const listId = args.listId ?? project.lists[0]?.id
  if (!listId || !project.lists.some(l => l.id === listId)) {
    return { ok: false, status: 400, error: args.listId ? 'That list is not in this project' : 'The project has no list to put a decision on' }
  }

  const draft = buildNewDecision({ title: args.title, goalsAndGuardrails: stated })
  const created = await createTaskWithSideEffects({
    input: {
      title: draft.title,
      description: draft.description,
      listIds: [listId],
      ...(args.assigneeId !== undefined ? { assigneeId: args.assigneeId } : {}),
    },
    actorId: args.userId,
    requireAssigneeListMembership: true,
  })
  if (!created.ok) return { ok: false, status: failureStatus(created.status), error: created.error }
  const task = created.task as { id: string; identifier?: string | null; title: string }
  return {
    ok: true,
    value: { task: { id: task.id, identifier: task.identifier ?? null, title: task.title, listIds: [listId] }, criteria: draft.criteria },
  }
}

async function decisionTasks(projectId: string, userId: string) {
  const rows = await prisma.task.findMany({
    where: {
      lists: { some: { projectId } },
      description: { contains: '**Decision:**' },
      OR: [{ isPrivate: false }, { creatorId: userId }, { assigneeId: userId }],
    },
    select: DECISION_TASK_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return rows.filter(row => parseDecision(row.description) !== null)
}

/** The project's decisions, open first and newest first within each. */
export async function listProjectDecisions(projectId: string, userId: string): Promise<GoalsResult<ProjectDecisionView[]>> {
  const loaded = await loadProjectForMember(projectId, userId)
  if (!loaded.ok) return loaded
  const views = (await decisionTasks(projectId, userId)).map((row): ProjectDecisionView => {
    const decision = parseDecision(row.description)!
    // A person's reply picks an option; an agent's note that starts with a digit does not.
    const replies = row.comments.filter(c => c.authorId && !c.authorId.startsWith('ai-agent-')).map(c => c.content)
    const chosen = chosenOption(row.description, replies)
    return {
      id: row.id,
      identifier: row.identifier ?? null,
      title: row.title,
      prompt: decision.prompt,
      options: decision.options.map(o => ({ number: o.number, text: o.text, recommended: o.recommended })),
      status: chosen ? 'decided' : 'open',
      chosen,
      assigneeId: row.assigneeId,
      createdAt: row.createdAt.toISOString(),
    }
  })
  return { ok: true, value: [...views.filter(v => v.status === 'open'), ...views.filter(v => v.status === 'decided')] }
}

/** Write the chosen option on the decision's description, replacing an earlier record. */
export async function decideProjectDecision(args: {
  projectId: string
  taskId: string
  userId: string
  option: number
}): Promise<GoalsResult<{ chosen: ChosenOption }>> {
  const loaded = await loadProjectForMember(args.projectId, args.userId)
  if (!loaded.ok) return loaded
  const task = (await decisionTasks(args.projectId, args.userId)).find(t => t.id === args.taskId)
  if (!task) return { ok: false, status: 404, error: 'Decision not found' }
  const description = recordDecided(task.description, args.option)
  if (description === null) return { ok: false, status: 400, error: 'That option is not in the decision' }
  if (recordedChoice(task.description)?.number !== args.option) {
    const updated = await updateTaskWithSideEffects({
      taskId: task.id,
      actorId: args.userId,
      intent: { description },
    })
    if (!updated.ok) return { ok: false, status: failureStatus(updated.status), error: updated.error }
  }
  return { ok: true, value: { chosen: chosenOption(description)! } }
}
