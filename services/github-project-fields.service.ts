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
 * values and one write per changed or cleared one — no N+1 reads.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { listVisibilityWhere } from '@/lib/list-permissions'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import { fetchProjectSchema } from '@/lib/github/projects/bind'
import {
  normaliseFields,
  planFieldSchema,
  planFieldValues,
  remoteFieldValues,
  scalarOf,
  valueColumns,
  type FieldDefinition,
  type FieldScalar,
  type HeldField,
  type KnownField,
  type MappedFieldIds,
  type RemoteFieldValues,
} from '@/lib/github/projects/fields'
import type { GraphqlClient } from '@/lib/github/rate-limiter'

const log = createLogger('services.github-project-fields')

/** A bound board, as the field sync needs it. */
export interface FieldBoard {
  projectId: string
  /** PVT_…; without it the schema cannot be refreshed, only read. */
  projectNodeId?: string
  binding: MappedFieldIds
}

const FIELD_SELECT = {
  id: true,
  remoteId: true,
  name: true,
  dataType: true,
  options: true,
  iterations: true,
  mappedTo: true,
  position: true,
} as const

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
  if (writes.length === 0) return false

  await prisma.$transaction(writes)
  log.info(
    { projectId: board.projectId, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length },
    'GitHub project fields refreshed',
  )
  return true
}

async function knownFields(projectId: string): Promise<Map<string, KnownField>> {
  const rows = await prisma.projectField.findMany({ where: { projectId }, select: FIELD_SELECT })
  return new Map(rows.map(row => [row.remoteId, row as unknown as KnownField]))
}

/** An archived item is off the board: it holds no values on it. */
const LEFT: RemoteFieldValues = { values: new Map(), unknown: false, complete: true }

/**
 * One page of items' field values onto their tasks. Answers whether anything
 * was written. Every task whose values changed has `updatedAt` bumped, so the
 * change rides the existing `?updatedSince=` delta (§9.4.3).
 *
 * With a `client`, a field, option or iteration the board has not met
 * refreshes the schema — once for the page.
 */
export async function applyFieldValues(
  board: FieldBoard,
  entries: Array<{ item: RemoteProjectItem; taskId: string }>,
  client?: GraphqlClient,
): Promise<boolean> {
  if (entries.length === 0) return false

  let fields = await knownFields(board.projectId)
  const read = () => entries.map(({ item, taskId }) => ({ taskId, remote: item.isArchived ? LEFT : remoteFieldValues(item, fields) }))
  let page = read()
  if (client && page.some(({ remote }) => remote.unknown) && (await syncProjectFields(board, client))) {
    fields = await knownFields(board.projectId)
    page = read()
  }
  if (fields.size === 0) return false

  const heldRows = await prisma.taskFieldValue.findMany({
    where: { projectId: board.projectId, taskId: { in: page.map(({ taskId }) => taskId) } },
    select: VALUE_SELECT,
  })
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
  if (touched.size === 0) return false

  await prisma.$transaction([
    // Another job may have hydrated the same item: (taskId, fieldId) is the key.
    ...(fresh.length > 0 ? [prisma.taskFieldValue.createMany({ data: fresh, skipDuplicates: true })] : []),
    ...writes,
    prisma.task.updateMany({ where: { id: { in: [...touched] } }, data: { updatedAt: new Date() } }),
  ])
  return true
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
