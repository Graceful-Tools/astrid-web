/**
 * The Pending results rules on the server's task writes (ADEV-279, docs/specs/GOALS_GUARDRAILS_SIGNALS.md → 7).
 *
 * Every update that can move a task into the column (services/task.service.ts, next to the Waiting
 * rules) asks lib/results-rules.ts `resultsWrite` here. The decision is astrid-core's (P1/P2/P6);
 * this module gathers its inputs and turns its answer into columns:
 *
 * - **Refused** (`RESULTS_NEEDS_CONDITION`): a 422 with a sentence a person can act on. The client's
 *   cue to show the picker: link an experiment, or "verify for N days".
 * - **`assignee: "clear"`**: the assignee is cleared in the same write and remembered on the task's
 *   open links (`TaskExperiment.returnAssigneeId`), as Waiting remembers a handoff's holder.
 *
 * Only a write that touches the lane costs a query: an edit that neither enters the column nor
 * happens inside it asks nothing.
 */
import { prisma } from '@/lib/prisma'
import { RESULTS_STATUS_ROLE } from '@/lib/board-presets'
import {
  resultsWrite,
  RESULTS_NEEDS_CONDITION,
  RESULTS_NEEDS_CONDITION_MESSAGE,
  type ResultsChange,
} from '@/lib/results-rules'
import { isOpenExperiment, toResultCondition } from '@/lib/task-experiment'

export type ResultsRefusal = { ok: false; status: 422; error: string; code: typeof RESULTS_NEEDS_CONDITION }

export interface ResultsDecision {
  ok: true
  /** Columns to merge into the write: `statusRole`, and `assigneeId`/`assigneeIds` when cleared. */
  data: Record<string, unknown>
}

const sameRole = (a: unknown, b: unknown) => ((a as string | null | undefined) ?? null) === ((b as string | null | undefined) ?? null)

/** A task's result conditions, as the rules read them. */
export async function loadResultConditions(taskId: string) {
  const rows = await prisma.taskExperiment.findMany({
    where: { taskId },
    select: { id: true, kind: true, state: true, verdict: true, decideBy: true, fetchedAt: true },
  })
  return { rows, conditions: rows.map(toResultCondition) }
}

export async function resolveResultsForUpdate(args: {
  existingTask: { id: string; statusRole?: string | null; assigneeId?: string | null; completed?: boolean | null }
  data: Record<string, unknown>
  requestedCompleted: boolean | undefined
  keepAssignee?: boolean
  now?: Date
}): Promise<ResultsDecision | ResultsRefusal> {
  const { existingTask, data, requestedCompleted, now = new Date() } = args
  const none: ResultsDecision = { ok: true, data: {} }

  // Done owns the lane (services/task-completion.ts): nothing to decide for a finished task.
  if (requestedCompleted ?? existingTask.completed) return none
  // Only a move: the web sends the whole task back on every edit, which is not one.
  const movesTo = Object.hasOwn(data, 'statusRole') && !sameRole(data.statusRole, existingTask.statusRole) ? data.statusRole : undefined
  if (movesTo !== RESULTS_STATUS_ROLE) return none

  const { rows, conditions } = await loadResultConditions(existingTask.id)
  const assigneeAfter = Object.hasOwn(data, 'assigneeId') ? ((data.assigneeId as string | null) ?? null) : (existingTask.assigneeId ?? null)
  const change: ResultsChange = { statusRole: RESULTS_STATUS_ROLE }
  if (args.keepAssignee) change.keepAssignee = true
  const answer = resultsWrite(
    { id: existingTask.id, statusRole: existingTask.statusRole ?? null, assigneeId: assigneeAfter, completed: false },
    conditions,
    change,
    now,
  )
  if (!answer.ok) return { ok: false, status: 422, error: RESULTS_NEEDS_CONDITION_MESSAGE, code: RESULTS_NEEDS_CONDITION }

  const { value } = answer
  if (value.transition === 'none') return none
  const columns: Record<string, unknown> = { statusRole: value.statusRole }
  if (value.assignee === 'clear') {
    columns.assigneeId = null
    columns.assigneeIds = []
    if (value.rememberAssigneeId) {
      await prisma.taskExperiment.updateMany({
        where: { id: { in: rows.filter(isOpenExperiment).map(row => row.id) } },
        data: { returnAssigneeId: value.rememberAssigneeId },
      })
    }
  }
  return { ok: true, data: columns }
}
