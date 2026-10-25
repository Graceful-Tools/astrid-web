/**
 * Per-run UI-test accounts (AWTD-1328): one account, its own lists and its own fixtures for each
 * iOS/Mac UI-test run, deleted afterwards.
 *
 * WHY. `scripts/uitest-account.ts --cookie` reset the ONE shared `uitest@` account on every mint,
 * and four runners mint it — iOS CI on every push, the iOS fixall loop, predeploy, and every local
 * `predeploy:full`. So a mint from one run deleted another run's data mid-test. A run of its own
 * makes two concurrent runs disjoint by construction rather than by timing.
 *
 * WHAT A RUN HOLDS — the fixtures the E2E journeys need and the shared account never had:
 *   - the five classic fixtures on "UI Test List";
 *   - a project-backed board with an Inbox card and a Doing card (Done is a completed task, so it
 *     needs no row — columns are config, see lib/project-status.ts);
 *   - a task due today at 09:00 UTC, a daily-repeating task due today, a task with one comment,
 *     and a task on no list;
 *   - a list owned by a second ephemeral user, `uitest+<run>-owner@`, on which the run's user is
 *     a VIEWER, so the permission matrix in docs/PRODUCT_CONTRACT.md can be exercised end to end.
 *
 * WHY RAW SQL WITH NAMED COLUMNS. Same reason as scripts/uitest-account.ts: this targets the
 * DEPLOYED database, and the generated client is built from a schema that can run ahead of it. A
 * model-level create names every column the client knows, and fails on one production lacks.
 *
 * THE GUARD. Every delete here is preceded by `assertUITestAccount` on the row's own email, read
 * back from the database — not on the email this module computed — so a user row that is not a
 * run account cannot be emptied however it was reached.
 */

import { randomUUID } from 'crypto'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import {
  FIXTURE_RESET_TASK_QUERY,
  UITEST_FIXTURE_TASKS,
  UITEST_LIST_NAME,
  assertUITestAccount,
  assertValidUITestRunId,
  parseUITestRunEmail,
  uitestRunEmail,
  uitestRunOwnerEmail,
} from '@/lib/uitest-fixtures'

/** The two raw-query methods this needs — a PrismaClient satisfies it. */
export interface RawDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

export const UITEST_BOARD_NAME = 'UI Test Board'
export const UITEST_SHARED_LIST_NAME = 'UI Test Shared (viewer)'

/** A run not re-minted for this long is abandoned — its runner died — and the next mint reaps it. */
export const UITEST_RUN_STALE_HOURS = 24

export interface FixtureRef {
  id: string
  title: string
}

export interface UITestRunFixtures {
  runId: string
  user: { id: string; email: string }
  owner: { id: string; email: string }
  lists: {
    main: { id: string; name: string }
    board: { id: string; name: string; projectId: string }
    /** Owned by `owner`; the run's user is a member with role `viewer`. */
    shared: { id: string; name: string; role: 'viewer' }
  }
  tasks: {
    /** The five classic fixtures, in UITEST_FIXTURE_TASKS order, on `lists.main`. */
    classic: Array<FixtureRef & { priority: number; completed: boolean }>
    boardInbox: FixtureRef
    boardDoing: FixtureRef & { statusRole: 'doing' }
    dueToday: FixtureRef & { dueDateTime: string }
    dailyRepeating: FixtureRef & { dueDateTime: string; repeating: 'daily' }
    withComment: FixtureRef & { commentId: string }
    noList: FixtureRef
    /** On `lists.shared`, created by `owner`. */
    shared: FixtureRef
  }
}

/** 09:00 UTC on `now`'s UTC day, and that day's midnight for the all-day repeating task. */
export function runFixtureDates(now: Date): { nineAm: Date; midnight: Date } {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { nineAm: new Date(midnight.getTime() + 9 * 60 * 60 * 1000), midnight }
}

async function ensureUser(db: RawDb, email: string, name: string): Promise<string> {
  const found = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "User" WHERE email = $1`, email)
  if (found.length) {
    // Touch it: the reaper goes by the last mint, so a long-lived run id is not reaped mid-use.
    await db.$executeRawUnsafe(`UPDATE "User" SET "updatedAt" = NOW() WHERE id = $1`, found[0].id)
    return found[0].id
  }
  const id = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO "User" (id, email, name, "emailVerified", "updatedAt")
     VALUES ($1, $2, $3, NOW(), NOW())`,
    id, email, name)
  return id
}

/**
 * Delete everything a run account owns or created — tasks (their comments and list memberships
 * cascade), lists (their members cascade) and projects — leaving the user row.
 */
async function emptyAccount(db: RawDb, userId: string): Promise<void> {
  const rows = await db.$queryRawUnsafe<Array<{ email: string | null }>>(
    `SELECT email FROM "User" WHERE id = $1`, userId)
  if (!rows.length) return
  assertUITestAccount(rows[0].email)
  if (!parseUITestRunEmail(rows[0].email)) {
    // The shared account has its own reset in scripts/uitest-account.ts; this one also drops
    // lists and projects, which the shared account's single list must survive.
    throw new Error(`Refusing to empty ${rows[0].email}: not a per-run UI-test account`)
  }

  const tasks = await db.$queryRawUnsafe<Array<{ id: string }>>(FIXTURE_RESET_TASK_QUERY, userId)
  if (tasks.length) {
    await db.$executeRawUnsafe(`DELETE FROM "Task" WHERE id = ANY($1::text[])`, tasks.map(t => t.id))
  }
  await db.$executeRawUnsafe(`DELETE FROM "TaskList" WHERE "ownerId" = $1`, userId)
  await db.$executeRawUnsafe(`DELETE FROM "Project" WHERE "ownerId" = $1`, userId)
}

interface NewTask {
  title: string
  creatorId: string
  assigneeId?: string | null
  listId?: string | null
  priority?: number
  completed?: boolean
  dueDateTime?: Date | null
  isAllDay?: boolean
  repeating?: string
  statusRole?: string | null
}

async function insertTask(db: RawDb, task: NewTask): Promise<string> {
  const id = randomUUID()
  const completed = task.completed ?? false
  // `repeatFrom` is left to its default (COMPLETION_DATE) except on the repeating fixture, which
  // rolls from its due date the way scheduled work does.
  await db.$executeRawUnsafe(
    `INSERT INTO "Task" (id, title, priority, completed, "completedAt", "creatorId", "assigneeId",
                         "dueDateTime", "isAllDay", repeating, "repeatFrom", "statusRole",
                         "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::"RepeatFromMode", $12, NOW(), NOW())`,
    id,
    task.title,
    task.priority ?? 0,
    completed,
    completed ? new Date() : null,
    task.creatorId,
    task.assigneeId ?? null,
    task.dueDateTime ?? null,
    task.isAllDay ?? false,
    task.repeating ?? 'never',
    task.repeating && task.repeating !== 'never' ? 'DUE_DATE' : 'COMPLETION_DATE',
    task.statusRole ?? null,
  )
  if (task.listId) {
    await db.$executeRawUnsafe(`INSERT INTO "_TaskToTaskList" ("A", "B") VALUES ($1, $2)`, id, task.listId)
  }
  return id
}

async function insertList(
  db: RawDb, ownerId: string, name: string, projectId: string | null = null,
): Promise<string> {
  const id = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO "TaskList" (id, name, color, "ownerId", "projectId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    id, name, DEFAULT_LIST_COLOR, ownerId, projectId)
  return id
}

/**
 * Ensure the run's two users and give them a fresh fixture set.
 *
 * Idempotent per run id: minting again keeps both user rows and replaces the fixtures, so a run
 * that re-mints (a retried CI step) starts from the same state rather than a doubled one. Touches
 * no row of any other run — every delete is keyed on this run's own two user ids.
 */
export async function mintUITestRun(
  db: RawDb, runId: string, now: Date = new Date(),
): Promise<UITestRunFixtures> {
  assertValidUITestRunId(runId)
  const email = uitestRunEmail(runId)
  const ownerEmail = uitestRunOwnerEmail(runId)

  const userId = await ensureUser(db, email, `UI Test ${runId}`)
  const ownerId = await ensureUser(db, ownerEmail, `UI Test ${runId} owner`)
  await emptyAccount(db, userId)
  await emptyAccount(db, ownerId)

  const mainListId = await insertList(db, userId, UITEST_LIST_NAME)

  // ASSIGNED as well as created: My Tasks filters on the assignee (see scripts/uitest-account.ts).
  const mine = { creatorId: userId, assigneeId: userId }
  const classic: UITestRunFixtures['tasks']['classic'] = []
  for (const fixture of UITEST_FIXTURE_TASKS) {
    const id = await insertTask(db, { ...mine, ...fixture, listId: mainListId })
    classic.push({ id, ...fixture })
  }

  const projectId = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO "Project" (id, name, color, "ownerId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    projectId, UITEST_BOARD_NAME, DEFAULT_LIST_COLOR, userId)
  await db.$executeRawUnsafe(
    `INSERT INTO "ProjectMember" (id, "projectId", "userId", role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'admin', NOW(), NOW())`,
    randomUUID(), projectId, userId)
  const boardListId = await insertList(db, userId, UITEST_BOARD_NAME, projectId)
  const boardInboxTitle = 'UITEST Board — inbox card'
  const boardDoingTitle = 'UITEST Board — doing card'
  const boardInboxId = await insertTask(db, { ...mine, title: boardInboxTitle, listId: boardListId })
  const boardDoingId = await insertTask(db, {
    ...mine, title: boardDoingTitle, listId: boardListId, statusRole: 'doing',
  })

  const { nineAm, midnight } = runFixtureDates(now)
  const dueTodayTitle = 'UITEST Fixture — due today 09:00'
  const dueTodayId = await insertTask(db, {
    ...mine, title: dueTodayTitle, listId: mainListId, dueDateTime: nineAm,
  })
  const repeatingTitle = 'UITEST Fixture — repeats daily'
  const repeatingId = await insertTask(db, {
    ...mine, title: repeatingTitle, listId: mainListId,
    dueDateTime: midnight, isAllDay: true, repeating: 'daily',
  })
  const withCommentTitle = 'UITEST Fixture — has a comment'
  const withCommentId = await insertTask(db, { ...mine, title: withCommentTitle, listId: mainListId })
  const commentId = randomUUID()
  await db.$executeRawUnsafe(
    `INSERT INTO "Comment" (id, content, "authorId", "taskId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    commentId, 'UITEST fixture comment', userId, withCommentId)
  const noListTitle = 'UITEST Fixture — on no list'
  const noListId = await insertTask(db, { ...mine, title: noListTitle })

  const sharedListId = await insertList(db, ownerId, UITEST_SHARED_LIST_NAME)
  await db.$executeRawUnsafe(
    `INSERT INTO "ListMember" (id, "listId", "userId", role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'viewer', NOW(), NOW())`,
    randomUUID(), sharedListId, userId)
  const sharedTitle = 'UITEST Shared — owner task'
  const sharedTaskId = await insertTask(db, { creatorId: ownerId, title: sharedTitle, listId: sharedListId })

  return {
    runId,
    user: { id: userId, email },
    owner: { id: ownerId, email: ownerEmail },
    lists: {
      main: { id: mainListId, name: UITEST_LIST_NAME },
      board: { id: boardListId, name: UITEST_BOARD_NAME, projectId },
      shared: { id: sharedListId, name: UITEST_SHARED_LIST_NAME, role: 'viewer' },
    },
    tasks: {
      classic,
      boardInbox: { id: boardInboxId, title: boardInboxTitle },
      boardDoing: { id: boardDoingId, title: boardDoingTitle, statusRole: 'doing' },
      dueToday: { id: dueTodayId, title: dueTodayTitle, dueDateTime: nineAm.toISOString() },
      dailyRepeating: {
        id: repeatingId, title: repeatingTitle, dueDateTime: midnight.toISOString(), repeating: 'daily',
      },
      withComment: { id: withCommentId, title: withCommentTitle, commentId },
      noList: { id: noListId, title: noListTitle },
      shared: { id: sharedTaskId, title: sharedTitle },
    },
  }
}

/**
 * Remove a run: both users and everything they own or created. Returns how many user rows went,
 * so deleting a run that does not exist is a visible 0 rather than an error.
 */
export async function deleteUITestRun(db: RawDb, runId: string): Promise<number> {
  assertValidUITestRunId(runId)
  const users = await db.$queryRawUnsafe<Array<{ id: string; email: string | null }>>(
    `SELECT id, email FROM "User" WHERE email = ANY($1::text[])`,
    [uitestRunEmail(runId), uitestRunOwnerEmail(runId)])
  for (const user of users) await emptyAccount(db, user.id)
  for (const user of users) {
    assertUITestAccount(user.email)
    await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = $1`, user.id)
  }
  return users.length
}

/**
 * Run ids whose accounts were last touched more than `hours` ago — runs whose runner died. A run
 * is stale only when ALL of its accounts are: activity on the run's user keeps the run alive even
 * though its owner account, which nobody signs in as, is only touched by a mint.
 */
export async function findStaleUITestRuns(db: RawDb, hours: number, now: Date = new Date()): Promise<string[]> {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error(`Stale age must be a positive number of hours, got ${hours}`)
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000)
  const rows = await db.$queryRawUnsafe<Array<{ email: string | null; updatedAt: Date }>>(
    `SELECT email, "updatedAt" FROM "User" WHERE email LIKE 'uitest+%'`)
  const stale = new Set<string>()
  const live = new Set<string>()
  for (const row of rows) {
    const parsed = parseUITestRunEmail(row.email)
    if (!parsed) continue
    ;(new Date(row.updatedAt) < cutoff ? stale : live).add(parsed.runId)
  }
  return [...stale].filter(runId => !live.has(runId)).sort()
}

export async function deleteStaleUITestRuns(db: RawDb, hours: number, now: Date = new Date()): Promise<string[]> {
  const runIds = await findStaleUITestRuns(db, hours, now)
  for (const runId of runIds) await deleteUITestRun(db, runId)
  return runIds
}
