/**
 * Recurrence on a GitHub board: spawning the next occurrence (AWTD-1118, P6b).
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §10.
 *
 * On a personal list a completed repeating task rolls the same row forward. On
 * a GitHub board it cannot: an issue is a thing on github.com with a number, a
 * timeline and comments, and reopening it every Monday would rewrite history
 * rather than record it. So the completed issue stays closed and the next
 * occurrence is a NEW issue linked to it.
 *
 *   enqueueRecurrenceSpawn(taskId)        the Astrid completion path's handoff
 *   enqueueRecurrenceForRemoteCompletions the same, for a close on github.com
 *   runRecurSpawn(payload, …)             the `recur` job itself
 *
 * Both triggers write the SAME dedupe key, `recur:<taskId>:<occurrenceCount>`,
 * so an Astrid completion racing the `issues.closed` webhook it causes makes
 * one issue rather than two (§10.1, "Exactly once").
 *
 * The planning is pure in lib/github/projects/recur.ts; this module does the
 * reads, the writes and the ordering.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { BRAND } from '@/lib/brand/config'
import { nextOccurrenceForTask } from '@/lib/repeating-rollover'
import { isKnownTimeZone } from '@/types/repeating'
import type { RepeatFromMode } from '@/types/task'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import type { BindingFieldMap, RemoteFieldValue } from '@/lib/github/projects/apply'
import { ADD_ITEM_DOCUMENT, parseCreatedContent } from '@/lib/github/projects/create'
import { hydrateItem } from '@/lib/github/projects/hydrate'
import { ISSUE_FIELD_ROWS, issueFieldsOf } from '@/lib/github/projects/fields'
import { createTasksInBulk } from '@/services/task-bulk-create'
import { isUniqueConstraintError } from '@/lib/secure-file-idempotency'
import {
  ADD_COMMENT_DOCUMENT,
  SPAWN_SOURCE_QUERY,
  nextOccurrenceComment,
  parseSpawnSource,
  planSpawnContent,
  planSpawnFields,
  recurDedupeKey,
  type RecurPayload,
  type SpawnMembership,
} from '@/lib/github/projects/recur'

const log = createLogger('services.github-recurrence')

/** The predecessor, as the job needs to see it in Astrid. */
const PREDECESSOR_SELECT = {
  id: true,
  title: true,
  description: true,
  completed: true,
  completedAt: true,
  closedReason: true,
  repeating: true,
  repeatingData: true,
  repeatFrom: true,
  occurrenceCount: true,
  dueDateTime: true,
  isAllDay: true,
  isPrivate: true,
  priority: true,
  remoteNodeId: true,
  remoteKind: true,
  assigneeId: true,
  assigneeIds: true,
  lists: { select: { id: true } },
} as const

/** The projects the predecessor is on, with everything a spawn needs about each. */
async function predecessorMemberships(taskId: string) {
  return prisma.gitHubProjectItem.findMany({
    where: { taskId, archived: false, binding: { detachedAt: null } },
    select: {
      itemNodeId: true,
      projectId: true,
      binding: {
        select: {
          projectNodeId: true,
          installationId: true,
          project: {
            select: {
              ownerId: true,
              // Issue-backed fields take updateIssueFieldValue (AWTD-1313).
              fields: ISSUE_FIELD_ROWS,
            },
          },
          statusFieldId: true,
          statusOptionMap: true,
          priorityFieldId: true,
          priorityOptionMap: true,
          dueFieldId: true,
        },
      },
    },
  })
}

type Membership = Awaited<ReturnType<typeof predecessorMemberships>>[number]

function fieldMap(binding: Membership['binding']): BindingFieldMap {
  return {
    statusFieldId: binding.statusFieldId,
    statusOptionMap: (binding.statusOptionMap ?? {}) as Record<string, string>,
    priorityFieldId: binding.priorityFieldId,
    priorityOptionMap: (binding.priorityOptionMap ?? null) as Record<string, number> | null,
    dueFieldId: binding.dueFieldId,
  }
}

/**
 * Queue the next occurrence instead of rolling this row forward. Returns
 * whether it took the series over — FALSE means the caller rolls forward as it
 * always has, which is the right answer both for a personal list and for a
 * queue insert that failed: a series that keeps running in the old mode is
 * recoverable, and one silently dropped is not.
 */
export async function enqueueRecurrenceSpawn(taskId: string): Promise<boolean> {
  try {
    const membership = await prisma.gitHubProjectItem.findFirst({
      where: { taskId, archived: false, binding: { detachedAt: null } },
      select: { binding: { select: { installationId: true } } },
    })
    if (!membership) return false

    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { occurrenceCount: true } })
    if (!task) return false

    await enqueueRecur(taskId, task.occurrenceCount, membership.binding.installationId)
    return true
  } catch (err) {
    log.error({ err, taskId }, 'Failed to queue the next occurrence; rolling forward instead')
    return false
  }
}

/**
 * The same handoff for a close that happened on github.com: `applyProjectItems`
 * writes the completion straight to the replica, so it never passes the
 * completion path that calls enqueueRecurrenceSpawn.
 *
 * Only tasks that were repeating and completed normally are queued; the job
 * re-checks all of it anyway, so this is a filter, not the rule.
 */
export async function enqueueRecurrenceForRemoteCompletions(taskIds: readonly string[]): Promise<number> {
  if (taskIds.length === 0) return 0
  try {
    const tasks = await prisma.task.findMany({
      where: { id: { in: [...taskIds] }, completed: true, closedReason: null, repeating: { not: 'never' } },
      select: { id: true, occurrenceCount: true },
    })
    if (tasks.length === 0) return 0

    const memberships = await prisma.gitHubProjectItem.findMany({
      where: { taskId: { in: tasks.map(t => t.id) }, archived: false, binding: { detachedAt: null } },
      select: { taskId: true, binding: { select: { installationId: true } } },
    })
    const installationFor = new Map(memberships.map(m => [m.taskId, m.binding.installationId]))

    let queued = 0
    for (const task of tasks) {
      const installationId = installationFor.get(task.id)
      if (!installationId) continue
      if (await enqueueRecur(task.id, task.occurrenceCount, installationId)) queued++
    }
    return queued
  } catch (err) {
    log.error({ err }, 'Failed to queue the next occurrence for a close on GitHub')
    return 0
  }
}

async function enqueueRecur(taskId: string, occurrenceCount: number, installationId: number): Promise<boolean> {
  const payload: RecurPayload = { taskId, occurrenceCount }
  const { count } = await prisma.gitHubSyncJob.createMany({
    data: [
      {
        kind: 'recur',
        installationId,
        dedupeKey: recurDedupeKey(taskId, occurrenceCount),
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  })
  return count > 0
}

/** The predecessor is history: its recurrence configuration moves off it (§10.1). */
async function clearRecurrence(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { repeating: 'never', repeatingData: Prisma.DbNull },
  })
}

/**
 * Run one `recur` job: create the next occurrence's issue, put it on every
 * project the predecessor was in, and link the two.
 *
 * Every guard is re-checked here rather than trusted from the payload, because
 * a job may run long after it was queued and either trigger may have raced it.
 */
export async function runRecurSpawn(
  payload: RecurPayload,
  installationId: number,
  client: GraphqlClient,
): Promise<void> {
  const task = await prisma.task.findUnique({ where: { id: payload.taskId }, select: PREDECESSOR_SELECT })
  if (!task) return

  // The series has already moved on — a peer spawn won, or the task was
  // reopened and completed again into a later occurrence. This job is stale.
  if (task.occurrenceCount !== payload.occurrenceCount) return
  if (!task.completed || task.closedReason) return
  if (task.repeating === 'never' || !task.repeating) return
  if (!task.remoteNodeId || task.remoteKind === 'pull_request') return

  const repeatFrom: RepeatFromMode = (task.repeatFrom as RepeatFromMode) || 'COMPLETION_DATE'
  const answer = nextOccurrenceForTask({
    repeating: task.repeating,
    pattern: task.repeatingData ?? null,
    currentDueDate: task.dueDateTime,
    completion: task.completedAt ?? new Date(),
    repeatFrom,
    occurrenceCount: task.occurrenceCount || 0,
    timeZone: 'UTC',
    isAllDay: task.isAllDay,
  })

  // Count or until reached: the predecessor completes and the series ends (§10.1).
  if (answer.shouldTerminate) {
    await clearRecurrence(task.id)
    return
  }

  const memberships = await predecessorMemberships(task.id)
  if (memberships.length === 0) return

  const source = parseSpawnSource(
    await client.query<{ node?: Parameters<typeof parseSpawnSource>[0]['node'] }>(SPAWN_SOURCE_QUERY, {
      id: task.remoteNodeId,
    }),
  )
  if (!source) {
    log.warn({ taskId: task.id }, 'GitHub no longer has the predecessor’s content; nothing to spawn from')
    return
  }

  // ── 1. The successor's content ──────────────────────────────────────────
  const contentPlan = planSpawnContent(source, { projectNodeId: memberships[0].binding.projectNodeId })
  const created = parseCreatedContent(
    await client.query<Record<string, unknown>>(contentPlan.document, contentPlan.variables, { strict: true }),
  )

  // ── 2. Its card on every project the predecessor was on ────────────────
  // A draft is created WITH its item in one project; the others still need it.
  const itemByProject = new Map<string, string>()
  if (created.itemNodeId) itemByProject.set(memberships[0].binding.projectNodeId, created.itemNodeId)

  for (const m of memberships) {
    if (itemByProject.has(m.binding.projectNodeId)) continue
    const added = await client.query<{ m0?: { item?: { id?: string } } }>(
      ADD_ITEM_DOCUMENT,
      { p: m.binding.projectNodeId, c: created.remoteNodeId },
      { strict: true },
    )
    const itemNodeId = added.m0?.item?.id
    if (itemNodeId) itemByProject.set(m.binding.projectNodeId, itemNodeId)
  }

  // ── 3. Its field values: the predecessor's, bar Status and the due date ─
  const spawnMemberships: SpawnMembership[] = []
  for (const m of memberships) {
    const itemNodeId = itemByProject.get(m.binding.projectNodeId)
    if (!itemNodeId) continue
    // The predecessor's own card, for the values being copied forward.
    const predecessorItem = await hydrateItem(client, m.itemNodeId)
    spawnMemberships.push({
      projectNodeId: m.binding.projectNodeId,
      itemNodeId,
      binding: fieldMap(m.binding),
      issueFields: issueFieldsOf(m.binding.project.fields ?? []),
      fieldValues: (predecessorItem?.fieldValues?.nodes ?? []) as RemoteFieldValue[],
    })
  }

  const nextDue = answer.nextDueDate === null ? null : new Date(answer.nextDueDate)
  const fieldPlan = planSpawnFields(spawnMemberships, nextDue, created)
  // The issue already exists, so nothing past this point may fail the job: a
  // retry starts at step 1 and creates ANOTHER issue. A field GitHub refuses
  // leaves the successor without that value, which a person can fix; a
  // duplicate issue per retry they cannot stop. (An issue field such as
  // "Target date" goes through updateIssueFieldValue — AWTD-1284, AWTD-1313.)
  if (fieldPlan.document) {
    try {
      await client.query(fieldPlan.document, fieldPlan.variables, { strict: true })
    } catch (err) {
      log.warn({ err, taskId: task.id, identifier: created.identifier }, 'Spawned the next occurrence but could not copy its field values')
    }
  }

  // ── 4. The successor in Astrid, carrying the series ────────────────────
  // What only Astrid knows about the occurrence; GitHub cannot tell a mirror.
  const series = {
    priority: task.priority,
    isAllDay: task.isAllDay,
    dueDateTime: nextDue,
    assigneeId: task.assigneeId,
    assigneeIds: task.assigneeIds,
    // The configuration MOVES to the new occurrence (§10.1).
    repeating: task.repeating,
    repeatingData: task.repeatingData ?? undefined,
    repeatFrom: task.repeatFrom,
    occurrenceCount: answer.newOccurrenceCount,
    previousOccurrenceId: task.id,
  }
  let successor: { id: string } | undefined
  try {
    // A board's tasks are the board's, exactly as applyProjectItems creates
    // every other mirrored task.
    const { tasks } = await createTasksInBulk({
      actorId: memberships[0].binding.project.ownerId,
      fromRemote: { source: 'GitHub' },
      tasks: [
        {
          listIds: task.lists.map(list => list.id),
          identifier: created.identifier,
          data: {
            ...series,
            title: task.title,
            description: task.description,
            isPrivate: task.isPrivate,
            remoteNodeId: created.remoteNodeId,
            remoteKind: created.remoteKind,
            remoteVersion: created.remoteVersion,
          },
        },
      ],
    })
    successor = tasks[0]
  } catch (err) {
    // GitHub's webhook for the new issue can mirror it before this insert —
    // seconds are enough, and steps 2–3 take that long. The row is the
    // successor; give it the series (AWTD-1284). Throwing here would retry
    // from step 1 and create another issue.
    if (!isUniqueConstraintError(err)) throw err
    successor = await prisma.task.update({
      where: { remoteNodeId: created.remoteNodeId },
      data: series,
      select: { id: true },
    })
  }

  if (!successor) {
    throw new Error(
      `Spawned ${created.identifier ?? created.remoteNodeId} on GitHub but could not record it in ${BRAND.appName}`,
    )
  }

  await prisma.gitHubProjectItem.createMany({
    data: [...itemByProject.entries()].flatMap(([projectNodeId, itemNodeId]) => {
      const m = memberships.find(x => x.binding.projectNodeId === projectNodeId)
      return m ? [{ itemNodeId, projectId: m.projectId, taskId: successor.id }] : []
    }),
    skipDuplicates: true,
  })

  // ── 5. The predecessor becomes history ─────────────────────────────────
  await clearRecurrence(task.id)

  const comment = nextOccurrenceComment(created.identifier)
  if (comment && source.remoteKind === 'issue') {
    // A cross-reference both ways on GitHub's timeline. Never worth failing
    // the spawn for: the issue exists and the series has moved.
    try {
      await client.query(ADD_COMMENT_DOCUMENT, { s: task.remoteNodeId, b: comment })
    } catch (err) {
      log.warn({ err, taskId: task.id }, 'Spawned the next occurrence but could not comment on the predecessor')
    }
  }

  log.info(
    { taskId: task.id, successor: successor.id, identifier: created.identifier, installationId },
    'Spawned the next occurrence',
  )
}
