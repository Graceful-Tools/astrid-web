/**
 * A GitHub board's project fields in the replica (AWTD-1117, P6a).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §9.4.1, §9.4.2, §13.3. The
 * rules are pure and live in lib/github/projects/fields.ts; this is their
 * executor, beside the replica writer (services/github-projects.service.ts).
 *
 *   syncProjectFields   GitHub's field definitions → ProjectField rows
 *   applyFieldValues    a page of items' values → TaskFieldValue rows
 *
 * GitHub sends no event when a field is defined, renamed or given an option
 * (§9.4.2), so the schema is refreshed on every reconcile and whenever an item
 * carries a field, option or iteration the board has not met.
 *
 * Per page: one field read and one value read, then one createMany for new
 * values and one write per changed or cleared one — no N+1 reads. Neither read
 * happens when it cannot change the plan, and a board that carries its schema
 * (`boundBoard`) is not read for it again (AWTD-1297).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { canUserEditTasks, listVisibilityWhere } from '@/lib/list-permissions'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import { fetchProjectSchema } from '@/lib/github/projects/bind'
import {
  carriesFieldValues,
  normaliseFields,
  planFieldSchema,
  planFieldValues,
  planFieldValueWrite,
  remoteFieldValues,
  scalarOf,
  valueColumns,
  type FieldDefinition,
  type FieldWriteRefusal,
  type FieldScalar,
  type HeldField,
  type KnownField,
  type MappedFieldIds,
  type RemoteFieldValues,
} from '@/lib/github/projects/fields'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { GITHUB_PROJECT_BACKEND, taskBackendFor } from '@/lib/backends/resolve'
import type { TaskBackend } from '@/lib/backends/types'

const log = createLogger('services.github-project-fields')

export const PROJECT_FIELD_SELECT = {
  id: true,
  remoteId: true,
  name: true,
  dataType: true,
  options: true,
  iterations: true,
  mappedTo: true,
  position: true,
} as const
const FIELD_SELECT = PROJECT_FIELD_SELECT

export type ProjectFieldRow = Prisma.ProjectFieldGetPayload<{ select: typeof PROJECT_FIELD_SELECT }>

/** A bound board, as the field sync needs it. */
export interface FieldBoard {
  projectId: string
  /** PVT_…; without it the schema cannot be refreshed, only read. */
  projectNodeId?: string
  binding: MappedFieldIds
  /**
   * The board's field schema, read once with the board rather than once per
   * page or per item (AWTD-1297). When present, `syncProjectFields` keeps it
   * current; when absent, each page reads it.
   */
  fields?: ProjectFieldRow[]
}

const VALUE_SELECT = { taskId: true, fieldId: true, text: true, number: true, date: true, optionId: true, iterationId: true } as const

function fieldRow(field: FieldDefinition) {
  return {
    remoteId: field.remoteId,
    name: field.name,
    dataType: field.dataType,
    options: (field.options as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
    iterations: (field.iterations as Prisma.InputJsonValue | null) ?? Prisma.DbNull,
    mappedTo: field.mappedTo,
    position: field.position,
  }
}

/**
 * Bring the board's ProjectField rows in line with GitHub's definitions.
 * Answers whether anything changed. A project GitHub will not show keeps the
 * fields already held: an unreadable schema is not an empty one.
 */
export async function syncProjectFields(board: FieldBoard, client: GraphqlClient): Promise<boolean> {
  if (!board.projectNodeId) return false
  const schema = await fetchProjectSchema(client, board.projectNodeId)
  if (!schema) return false

  const held = await prisma.projectField.findMany({ where: { projectId: board.projectId }, select: FIELD_SELECT })
  const plan = planFieldSchema(normaliseFields(schema.fields.nodes, board.binding), held as unknown as HeldField[])

  // A field newly mapped to a Task column has one source for its value now.
  const nowMapped = plan.update.filter(({ data }) => data.mappedTo).map(({ id }) => id)
  const writes: Prisma.PrismaPromise<unknown>[] = [
    // Values go with a removed field (cascade).
    ...(plan.remove.length > 0 ? [prisma.projectField.deleteMany({ where: { id: { in: plan.remove } } })] : []),
    ...plan.update.map(({ id, data }) => prisma.projectField.update({ where: { id }, data: fieldRow(data) })),
    ...(nowMapped.length > 0 ? [prisma.taskFieldValue.deleteMany({ where: { fieldId: { in: nowMapped } } })] : []),
    ...(plan.create.length > 0
      ? [
          prisma.projectField.createMany({
            data: plan.create.map(field => ({ projectId: board.projectId, ...fieldRow(field) })),
            // Another job may be meeting the same fields: (projectId, remoteId) is unique.
            skipDuplicates: true,
          }),
        ]
      : []),
  ]
  if (writes.length === 0) {
    if (board.fields) board.fields = held
    return false
  }

  await prisma.$transaction(writes)
  if (board.fields) board.fields = await prisma.projectField.findMany({ where: { projectId: board.projectId }, select: FIELD_SELECT })
  log.info(
    { projectId: board.projectId, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length },
    'GitHub project fields refreshed',
  )
  return true
}

async function knownFields(board: FieldBoard): Promise<ProjectFieldRow[]> {
  return board.fields ?? prisma.projectField.findMany({ where: { projectId: board.projectId }, select: FIELD_SELECT })
}

const byRemoteId = (rows: ProjectFieldRow[]) => new Map(rows.map(row => [row.remoteId, row as unknown as KnownField]))

/** An archived item is off the board: it holds no values on it. */
const LEFT: RemoteFieldValues = { values: new Map(), unknown: false, complete: true }

export interface FieldValueEntry {
  item: RemoteProjectItem
  taskId: string
  /** False when the task is known to hold no values on this board, so none are read. */
  holdsValues?: boolean
}

export interface FieldPage {
  /** Whether anything was written. */
  changed: boolean
  /** The schema the page was read against; null when no item needed it. */
  fields: ProjectFieldRow[] | null
  /** Each task's values once the page is applied (ProjectField.id → value); a task holding none is absent. */
  values: Map<string, Map<string, FieldScalar>>
}

/**
 * One page of items' field values onto their tasks. Every task whose values
 * changed has `updatedAt` bumped, so the change rides the existing
 * `?updatedSince=` delta (§9.4.3).
 *
 * With a `client`, a field, option or iteration the board has not met
 * refreshes the schema — once for the page.
 *
 * Reads only what can change the plan (AWTD-1297): no schema read when no
 * item carries a stored type and no task holds a value, and no value read for
 * a task known to hold none.
 */
export async function applyFieldPage(board: FieldBoard, entries: FieldValueEntry[], client?: GraphqlClient): Promise<FieldPage> {
  const values = new Map<string, Map<string, FieldScalar>>()
  const needed = entries.filter(
    ({ item, holdsValues }) => holdsValues !== false || (!item.isArchived && carriesFieldValues(item, board.binding)),
  )
  if (needed.length === 0) return { changed: false, fields: null, values }

  let rows = await knownFields(board)
  let fields = byRemoteId(rows)
  const read = () => needed.map(({ item, taskId }) => ({ taskId, remote: item.isArchived ? LEFT : remoteFieldValues(item, fields) }))
  let page = read()
  if (client && page.some(({ remote }) => remote.unknown) && (await syncProjectFields(board, client))) {
    rows = await knownFields(board)
    fields = byRemoteId(rows)
    page = read()
  }
  if (fields.size === 0) return { changed: false, fields: rows, values }

  const holders = needed.filter(({ holdsValues }) => holdsValues !== false).map(({ taskId }) => taskId)
  const heldRows =
    holders.length > 0
      ? await prisma.taskFieldValue.findMany({ where: { projectId: board.projectId, taskId: { in: holders } }, select: VALUE_SELECT })
      : []
  const held = new Map<string, Map<string, FieldScalar>>()
  for (const row of heldRows) {
    const value = scalarOf(row)
    if (value === null) continue
    if (!held.has(row.taskId)) held.set(row.taskId, new Map())
    held.get(row.taskId)!.set(row.fieldId, value)
  }

  const dataTypeOf = new Map([...fields.values()].map(field => [field.id, field.dataType]))
  const fresh: Prisma.TaskFieldValueCreateManyInput[] = []
  const writes: Prisma.PrismaPromise<unknown>[] = []
  const touched = new Set<string>()

  for (const { taskId, remote } of page) {
    const mine = held.get(taskId) ?? new Map<string, FieldScalar>()
    const plan = planFieldValues(remote, mine)
    const after = new Map(mine)
    for (const [fieldId, value] of plan.set) after.set(fieldId, value)
    for (const fieldId of plan.clear) after.delete(fieldId)
    if (after.size > 0) values.set(taskId, after)
    if (plan.set.length === 0 && plan.clear.length === 0) continue
    touched.add(taskId)
    for (const [fieldId, value] of plan.set) {
      const columns = valueColumns(dataTypeOf.get(fieldId) as string, value)
      if (mine.has(fieldId)) {
        writes.push(prisma.taskFieldValue.update({ where: { taskId_fieldId: { taskId, fieldId } }, data: columns }))
      } else {
        fresh.push({ taskId, fieldId, projectId: board.projectId, ...columns })
      }
    }
    if (plan.clear.length > 0) {
      writes.push(prisma.taskFieldValue.deleteMany({ where: { taskId, fieldId: { in: plan.clear } } }))
    }
  }
  if (touched.size === 0) return { changed: false, fields: rows, values }

  await prisma.$transaction([
    // Another job may have hydrated the same item: (taskId, fieldId) is the key.
    ...(fresh.length > 0 ? [prisma.taskFieldValue.createMany({ data: fresh, skipDuplicates: true })] : []),
    ...writes,
    prisma.task.updateMany({ where: { id: { in: [...touched] } }, data: { updatedAt: new Date() } }),
  ])
  return { changed: true, fields: rows, values }
}

/** `applyFieldPage`, answering only whether anything was written. */
export async function applyFieldValues(board: FieldBoard, entries: FieldValueEntry[], client?: GraphqlClient): Promise<boolean> {
  return (await applyFieldPage(board, entries, client)).changed
}

/** A field definition as `GET /api/v1/projects/:id/fields` serves it. */
export interface ProjectFieldSchemaEntry {
  id: string
  remoteId: string
  name: string
  dataType: string
  options: Prisma.JsonValue
  iterations: Prisma.JsonValue
  mappedTo: string | null
  position: number
}

export type ProjectFieldSchemaResult =
  | { error: 'not_found' }
  | { fields: ProjectFieldSchemaEntry[]; etag: string }

/**
 * A board's field schema for a caller who may or may not be allowed to see it
 * (AWTD-1208, §9.4.3).
 *
 * Lives here rather than in the route because `tests/rules/prisma-in-routes-ratchet.test.ts`
 * is a one-way ratchet on routes importing Prisma directly, and the fix it asks
 * for is this one: *"a genuinely new kind of data access → lower the ceiling in
 * a later slice rather than treating this as the budget."*
 *
 * **Visibility, not ownership.** The schema is what makes a task's `fields`
 * legible, so a member who can load the board's tasks must be able to read it;
 * `authorizeBoardOwner` would shut all of them out. A board is readable when one
 * of its lists is, which is the rule the list routes already apply — derived from
 * `listVisibilityWhere` rather than restated, so the two cannot drift apart.
 *
 * **404, never 403**, for a board the caller cannot see: a 403 would confirm it
 * exists.
 *
 * **The ETag covers deletion.** It is built from the newest `updatedAt` AND the
 * row count, because removing a field moves no surviving row's timestamp — a
 * timestamp-only tag would serve a 304 holding a field that is gone.
 */
export async function readProjectFieldSchema(
  projectId: string,
  userId: string,
): Promise<ProjectFieldSchemaResult> {
  const visible = await prisma.taskList.findFirst({
    where: { projectId, ...listVisibilityWhere(userId, { includePublic: true }) },
    select: { id: true },
  })
  if (!visible) return { error: 'not_found' }

  const rows = await prisma.projectField.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      remoteId: true,
      name: true,
      dataType: true,
      options: true,
      iterations: true,
      mappedTo: true,
      position: true,
      updatedAt: true,
    },
  })

  const newest = rows.reduce((max, field) => Math.max(max, field.updatedAt.getTime()), 0)
  return {
    fields: rows.map(({ updatedAt, ...field }) => field),
    etag: `"fields-${projectId}-${rows.length}-${newest}"`,
  }
}

// ── Writing one value back (AWTD-1209, P6a-3) ───────────────────────────────

export type SetFieldValueResult =
  /** The task, the field, or the board is not visible — 404, never 403 (§9.4.2). */
  | { error: 'not_found' }
  /** Visible, but the caller may not edit this board's tasks. */
  | { error: 'forbidden' }
  /** The value itself is wrong for the field: a named 400. */
  | { refused: FieldWriteRefusal }
  /** GitHub refused or was unreachable; the codes are P5a's. */
  | { backend: { status: 400 | 403 | 409 | 429 | 502; error: string; retryAfter?: number; ssoUrl?: string } }
  | { ok: true; scalar: FieldScalar | null }

interface SetFieldValueDeps {
  backendFor: (listIds: readonly string[]) => Promise<TaskBackend>
}

const setFieldValueDefaults: SetFieldValueDeps = { backendFor: taskBackendFor }

/**
 * `PUT /api/v1/tasks/:id/fields/:fieldId` (§9.4.2).
 *
 * **GitHub first, replica second.** The remote write happens before the
 * `TaskFieldValue` row is touched, so a refusal leaves the replica agreeing
 * with GitHub rather than holding a value that never landed. The reverse
 * order would need a compensating write that itself can fail.
 *
 * **404, never 403, for a board the caller cannot see**, the same rule
 * `readProjectFieldSchema` applies — a 403 would confirm it exists. A caller
 * who CAN see the board but may not edit its tasks gets 403, which tells them
 * nothing they did not already know.
 *
 * **One field per request**, so two edits to different fields never contend;
 * `@@unique([taskId, fieldId])` makes the replica write idempotent.
 *
 * `Task.updatedAt` is bumped on success so the change rides the existing
 * `?updatedSince=` delta, exactly as `applyFieldValues` does for inbound ones.
 */
export async function setProjectFieldValue(
  taskId: string,
  fieldId: string,
  value: unknown,
  userId: string,
  deps: SetFieldValueDeps = setFieldValueDefaults,
): Promise<SetFieldValueResult> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, lists: { some: listVisibilityWhere(userId, { includePublic: false }) } },
    select: {
      id: true,
      lists: { select: { id: true, backend: true, projectId: true, ownerId: true, listMembers: true, privacy: true } },
    },
  })
  if (!task) return { error: 'not_found' }

  const board = task.lists.find(list => list.backend === GITHUB_PROJECT_BACKEND && list.projectId)
  if (!board) return { error: 'not_found' }

  const field = await prisma.projectField.findFirst({
    where: { id: fieldId, projectId: board.projectId as string },
    select: { remoteId: true, name: true, dataType: true, options: true, iterations: true, mappedTo: true, position: true },
  })
  if (!field) return { error: 'not_found' }

  if (!canUserEditTasks({ id: userId }, board as never)) return { error: 'forbidden' }

  const definition: FieldDefinition = {
    remoteId: field.remoteId,
    name: field.name,
    dataType: field.dataType as FieldDefinition['dataType'],
    options: field.options as FieldDefinition['options'],
    iterations: field.iterations as FieldDefinition['iterations'],
    mappedTo: field.mappedTo as FieldDefinition['mappedTo'],
    position: field.position,
  }

  const plan = planFieldValueWrite(definition, value)
  if ('refused' in plan) return { refused: plan.refused }

  const backend = await deps.backendFor([board.id])
  const written = await backend.setFieldValue({ actorId: userId }, taskId, field.remoteId, plan.value)
  if (!written.ok) {
    const { status, error, retryAfter, ssoUrl } = written
    return { backend: { status, error, ...(retryAfter ? { retryAfter } : {}), ...(ssoUrl ? { ssoUrl } : {}) } }
  }

  await prisma.$transaction([
    plan.scalar === null
      ? prisma.taskFieldValue.deleteMany({ where: { taskId, fieldId } })
      : prisma.taskFieldValue.upsert({
          where: { taskId_fieldId: { taskId, fieldId } },
          create: { taskId, fieldId, projectId: board.projectId as string, ...valueColumns(field.dataType, plan.scalar) },
          update: valueColumns(field.dataType, plan.scalar),
        }),
    prisma.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } }),
  ])

  log.info({ taskId, fieldId, cleared: plan.scalar === null }, 'Wrote a project field value through to GitHub')
  return { ok: true, scalar: plan.scalar }
}
