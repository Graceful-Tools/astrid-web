/**
 * Tasks API v1
 *
 * RESTful endpoint for task operations
 * GET /api/v1/tasks - List tasks
 * POST /api/v1/tasks - Create task
 */

import { type NextRequest, NextResponse } from 'next/server'
import type { V1TaskCreateRequest } from '@/lib/api-contracts/v1-request-shapes'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { validateParentTask } from '@/lib/subtasks'
import { detectPlatform } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createTaskWithSideEffects, type CreatedTask } from '@/services/task.service'
import { createLogger } from '@/lib/logger'
import { getDeletionsSince } from '@/lib/deletion-log'
import { assigneeIdsOf } from '@/lib/task-assignees'
import { parseOmittedTaskFields } from '@/lib/tasks/v1-task-omit'
import { shapeV1ListPageTask, v1TaskListSelect, v1TaskPageMeta } from '@/lib/tasks/v1-task-shape'
import { withTaskRemote } from '@/lib/backends/task-remote'
import {
  decodeTaskCursor,
  encodeTaskCursor,
  InvalidTaskCursorError,
  TASK_CURSOR_ORDER_BY,
  taskCursorWhere,
  type TaskSyncCursor,
} from '@/lib/tasks/v1-sync-cursor'

const log = createLogger('v1.tasks')

/**
 * GET /api/v1/tasks
 * List tasks with optional filters
 *
 * Query parameters:
 * - listId: Filter by list ID
 * - completed: true/false
 * - priority: 0-2
 * - assigneeId: Filter by assignee
 * - assigneeEmail: Filter by the assignee's email (case-insensitive)
 * - statusRole: Filter by board status (ready | doing | waiting | a project's
 *   custom role). `none` selects Inbox — the tasks carrying no status at all.
 * - limit: Max results (default: 100)
 * - offset: Pagination offset (default: 0)
 * - includeComments: true/false (default: false)
 * - updatedSince: ISO timestamp; return only tasks updated after it (delta sync)
 * - omit: comma-separated fields to leave out — `description`, `listMembers`
 *   (AWTD-1236). Opt-out, so omitting the param returns the full response as
 *   before; `description` is ~80% of a full page's bytes. Unrecognised names
 *   are ignored, and `meta.omitted` reports what the server actually dropped.
 * - leanListMembers: `1` — the older spelling of `omit=listMembers`
 * - cursor: keyset paging on (updatedAt, id) instead of `offset` (AWTD-1470).
 *   Empty to start a walk, then the previous page's `nextCursor`. Stable under
 *   concurrent edits, which offset paging is not. Malformed → 400.
 *
 * Every response carries `serverTime` — the server's clock, read BEFORE the
 * query — for the client to send back as the next `updatedSince` instead of
 * its own (skewed) clock.
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.tasks' },
  async (req, auth) => {
    // Before the read, so a write that lands while the query runs is newer
    // than this stamp and the client's next delta picks it up.
    const serverTime = new Date().toISOString()
    const url = new URL(req.url)
    const listId = url.searchParams.get('listId')
    // Keyset paging (AWTD-1470). `null` param → offset mode, exactly as before.
    const cursorParam = url.searchParams.get('cursor')
    let cursor: TaskSyncCursor | null = null
    if (cursorParam !== null) {
      try {
        cursor = decodeTaskCursor(cursorParam)
      } catch (error) {
        if (error instanceof InvalidTaskCursorError) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    }
    const isCursorWalk = cursorParam !== null
    // Only apply completed filter if explicitly provided
    const completedParam = url.searchParams.get('completed')
    const completed = completedParam !== null ? completedParam === 'true' : undefined
    const priority = url.searchParams.get('priority')
    const assigneeId = url.searchParams.get('assigneeId')
    const assigneeEmail = url.searchParams.get('assigneeEmail')?.trim()
    // Board status as a state on the task (AWTD-562). Filtering here rather than
    // in the caller is what keeps a status query to ONE request: the old shape —
    // fetch the board, filter client-side — silently truncates against `limit`,
    // so a busy board can hide a ready task behind 100 unrelated ones.
    const statusRole = url.searchParams.get('statusRole')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const includeComments = url.searchParams.get('includeComments') === 'true'
    // Lean mode: drop fields this caller does not need (AWTD-1236). Opt-out,
    // so an absent param returns exactly the response every client gets today;
    // `description` alone is 80% of a full page, and only the sync needs it.
    const omit = parseOmittedTaskFields(url.searchParams.get('omit'))
    // `leanListMembers=1` is the older spelling of `omit=listMembers` and still
    // works — a client may be sending it. New callers should use `omit`.
    const leanListMembers =
      url.searchParams.get('leanListMembers') === '1' || omit.has('listMembers')
    // GitHub project field values, OPT-IN on this route (AWTD-1208, §9.4.3).
    // Measured 2026-10-12: a thousand tasks carrying eight fields each adds
    // 42.2 KiB to the gzipped response, and the full task response is already
    // 551.8 KiB on the wire against a 500 KiB budget. The spec's rule decides
    // it — "the budget wins over convenience" — so a list view asks for them
    // only when it will show them, and the detail route carries them always.
    //
    // `include` and `omit` are the two halves of the same idea and they do not
    // overlap: a field is opt-IN when carrying it is expensive for everyone,
    // opt-OUT when dropping it is what a caller has to choose.
    const includeFields = url.searchParams
      .get('include')
      ?.split(',')
      .map(part => part.trim())
      .includes('fields') ?? false
    // Delta sync: return only tasks touched since this instant. Optional and
    // purely additive — omitting it leaves the query exactly as it was, which
    // is what keeps this from being a breaking change for existing clients.
    const updatedSinceParam = url.searchParams.get('updatedSince')
    const updatedSince = updatedSinceParam ? new Date(updatedSinceParam) : null
    const hasValidUpdatedSince = !!updatedSince && !Number.isNaN(updatedSince.getTime())

    const where: any = {}

    if (listId) {
      // Filtering by a specific list returns ONLY that list's tasks; caller
      // must have access to the list (owner, member, or public).
      where.lists = {
        some: {
          id: listId,
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
            { privacy: 'PUBLIC' },
          ],
        },
      }
    } else {
      // No listId: the caller's own tasks. Public lists are deliberately NOT
      // OR-ed in (AWTD-1451): that made this read, and its count, scan every
      // public list in the deployment. They stay reachable by `?listId=`.
      where.OR = [
        { creatorId: auth.userId },
        { assigneeId: auth.userId },
        {
          lists: {
            some: {
              OR: [
                { ownerId: auth.userId },
                { listMembers: { some: { userId: auth.userId } } },
              ],
            },
          },
        },
      ]
    }

    // Narrows an already-built visibility clause; never widens it. An
    // unparseable cursor is ignored rather than applied, so a bad value cannot
    // silently empty the caller's task list.
    if (hasValidUpdatedSince) {
      where.updatedAt = { gt: updatedSince }
    }

    if (completed !== undefined) {
      where.completed = completed
    }
    if (priority) {
      where.priority = parseInt(priority)
    }
    if (assigneeId) {
      where.assigneeId = assigneeId
    }
    // AWTD-1020: ignoring this returned an arbitrary task, whose assignee the
    // agent-author lookup then signed comments as.
    if (assigneeEmail) {
      where.assignee = { email: { equals: assigneeEmail, mode: 'insensitive' } }
    }
    // Inbox is the ABSENCE of a status, so it is a null column rather than a
    // value — same distinction /api/v1/search draws for `status:none`.
    if (statusRole) {
      where.statusRole = statusRole === 'none' ? null : statusRole
    }

    // The keyset is ANDed on, never merged into `where.OR` — that is the
    // visibility clause, and widening it would leak other people's tasks.
    const pageWhere = cursor ? { ...where, AND: [taskCursorWhere(cursor)] } : where

    const [pageRows, total] = await Promise.all([
      prisma.task.findMany({
        where: pageWhere,
        select: v1TaskListSelect({ omit, leanListMembers, includeComments, includeFields }),
        orderBy: isCursorWalk
          ? TASK_CURSOR_ORDER_BY
          : [
              { completed: 'asc' },
              { priority: 'desc' },
              { createdAt: 'desc' },
            ],
        // One extra row in a walk says whether there is a next page without
        // a second query.
        take: isCursorWalk ? limit + 1 : limit,
        skip: isCursorWalk ? 0 : offset,
      }),
      prisma.task.count({ where }),
    ])
    const hasMore = isCursorWalk && pageRows.length > limit
    const tasks = hasMore ? pageRows.slice(0, limit) : pageRows
    const nextCursor = hasMore ? encodeTaskCursor(tasks[tasks.length - 1]) : undefined

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // A pure shaper, so the wire-shape contract fixture runs this exact code
    // (AWTD-1263).
    const tasksWithListIds = tasks.map(shapeV1ListPageTask)

    // Delta responses also carry what disappeared. Tasks are hard-deleted, so
    // without this a client syncing incrementally keeps showing tasks that are
    // already gone. Only present for delta requests, so a full fetch returns
    // exactly the response shape it always did.
    const deletedIds = hasValidUpdatedSince
      ? await getDeletionsSince('task', auth.userId, updatedSince!)
      : undefined

    return NextResponse.json(
      {
        tasks: tasksWithListIds,
        ...(deletedIds ? { deletedIds } : {}),
        serverTime,
        ...(nextCursor ? { nextCursor } : {}),
        meta: v1TaskPageMeta({ total, limit, offset: isCursorWalk ? 0 : offset, authSource: auth.source, omit }),
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/tasks
 * Create a new task
 *
 * Body:
 * {
 *   title: string (required)
 *   description?: string
 *   listIds?: string[]
 *   priority?: number (0-2)
 *   assigneeId?: string
 *   dueDateTime?: ISO datetime string
 *   isAllDay?: boolean
 *   reminderTime?: ISO datetime string
 *   reminderType?: 'push' | 'email' | 'both'
 *   isPrivate?: boolean
 *   repeating?: string
 *   repeatingData?: object (custom pattern; only read when repeating is "custom")
 *   repeatFrom?: 'DUE_DATE' | 'COMPLETION_DATE'
 *   clientRequestId?: string (8-128 chars; idempotency key)
 * }
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.tasks' },
  async (req, auth) => {
    // Typed rather than `any`, so a misspelled field is a build error instead
    // of one that silently never applies. Not validation — a cast cannot make a
    // client honest. See lib/api-contracts/v1-request-shapes.ts. (Task 87e19910.)
    const body = (await req.json()) as V1TaskCreateRequest

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'title is required and must be a string' },
        { status: 400 }
      )
    }

    // ── Subtasks: validate parentTaskId if provided ────────────────────
    // Stays here: subtasks are a v1 concept and no other create surface
    // accepts a parent.
    const rawParentTaskId =
      typeof body.parentTaskId === 'string' && body.parentTaskId ? body.parentTaskId : null
    if (rawParentTaskId) {
      const parentError = await validateParentTask(rawParentTaskId)
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 })
      }
    }

    // Board status at creation (task eb7fce2f). A ROLE, matching the update
    // route: the board's add-task form sends the target column here so a task
    // created on "Ready" lands on Ready — the column id must never travel
    // inside listIds, where it reads as a nonexistent list and 400s the write.
    const rawStatusRole =
      typeof body.statusRole === 'string' && body.statusRole.trim()
        ? body.statusRole.trim()
        : null

    const result = await createTaskWithSideEffects({
      input: {
        title: body.title,
        description: body.description,
        priority: body.priority,
        listIds: body.listIds,
        assigneeId: body.assigneeId,
        dueDateTime: body.dueDateTime,
        when: body.when,
        isAllDay: body.isAllDay,
        // Named here or dropped: the service honours both, but this input is
        // built field by field (AWTD-1446).
        reminderTime: body.reminderTime,
        reminderType: body.reminderType,
        isPrivate: body.isPrivate,
        repeating: body.repeating,
        // The update route has accepted both since it shipped; create ignored
        // them, which made a repeating task impossible to file in one call —
        // and docs/FIXALL_WORKFLOW.md names exactly that as the alternative to
        // a cron (task ee44bc35). `customRepeatingData` is the service's name
        // for the same field; the wire name here matches the column and PUT.
        customRepeatingData: body.repeatingData,
        repeatFrom: body.repeatFrom,
        clientRequestId: body.clientRequestId,
        parentTaskId: rawParentTaskId,
        statusRole: rawStatusRole,
      },
      actorId: auth.userId,
      platform: detectPlatform(req),
      // v1's own rule: an assignee must already hold a role on one of the
      // task's lists, or arbitrary users could be assigned work. Legacy cannot
      // adopt it — its assign-by-email path mints a placeholder user who has
      // not accepted an invitation and is a member of nothing.
      requireAssigneeListMembership: true,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        task: narrowCreatedTaskForV1(result.task),
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
          ...(result.idempotent ? { idempotent: true } : {}),
        },
      },
      { status: result.idempotent ? 200 : 201, headers }
    )
  }
)

/**
 * The v1 wire shape for a created task.
 *
 * The service creates with one canonical include so that every surface writes
 * identical DB state, and that include is legacy's — the richest of the four.
 * It carries `list.owner` and `listMembers.user`, whole user records with
 * email addresses on them. Returning it here verbatim would newly publish
 * every list member's email to v1 API consumers, so this narrows back to the
 * exact shape v1 has always returned. Same row, unchanged contract.
 */
function narrowCreatedTaskForV1(task: CreatedTask) {
  const { lists, assignee, creator, comments, ...scalars } = task as unknown as Record<string, any>

  return {
    ...withTaskRemote(scalars),
    assigneeIds: assigneeIdsOf(scalars),
    lists: (lists ?? []).map((list: any) => ({
      id: list.id,
      name: list.name,
      color: list.color,
      ownerId: list.ownerId,
      description: list.description,
      listMembers: (list.listMembers ?? []).map((member: any) => ({
        id: member.id,
        listId: member.listId,
        userId: member.userId,
        role: member.role,
      })),
    })),
    assignee: assignee
      ? {
          id: assignee.id,
          name: assignee.name,
          email: assignee.email,
          image: assignee.image,
          isAIAgent: assignee.isAIAgent,
          aiAgentType: assignee.aiAgentType,
        }
      : null,
    creator: creator
      ? {
          id: creator.id,
          name: creator.name,
          email: creator.email,
          image: creator.image,
          isAIAgent: creator.isAIAgent,
        }
      : null,
    // v1 has always returned bare comments; the canonical include hydrates
    // their authors for the SSE payload, which is not part of this contract.
    comments: (comments ?? []).map(({ author: _author, ...comment }: any) => comment),
  }
}
