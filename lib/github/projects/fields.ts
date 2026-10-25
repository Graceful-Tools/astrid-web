/**
 * A GitHub project's own fields, and each item's values for them (AWTD-1117, P6a).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §9.4. On a GitHub-backed board
 * every project field is shown. Fields are defined in GitHub — Astrid never
 * creates one — so the replica holds the schema (`ProjectField`) and one row per
 * (task, field) that has a value (`TaskFieldValue`).
 *
 *   normaliseFields(schema, binding)   GitHub's fields → the ones Astrid keeps
 *   planFieldSchema(remote, held)      create | update | remove, by value
 *   remoteFieldValues(item, fields)    an item's values, compact, by field id
 *   planFieldValues(remote, held)      set | clear, by value
 *
 * Pure functions — no network, no database. Status, Priority and due are MAPPED:
 * their values live in native Task columns (apply.ts) and are never stored
 * here, so there is one source per value. Estimate has no Task column (P4a) and
 * is an ordinary field.
 */

import type { RemoteProjectItem } from './apply'

/** Field values read per item. Past this the read may be cut short, and nothing is cleared. */
export const FIELD_VALUES_PER_ITEM = 20

export type FieldDataType = 'text' | 'number' | 'date' | 'single_select' | 'iteration'

/** GitHub's dataType → Astrid's. Anything absent (Title, Assignees, Labels, …) is not a field here. */
const DATA_TYPE: Record<string, FieldDataType> = {
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
  SINGLE_SELECT: 'single_select',
  ITERATION: 'iteration',
}

export interface FieldOption {
  id: string
  name: string
  color?: string | null
  description?: string | null
}

export interface FieldIteration {
  id: string
  title: string
  startDate: string
  duration: number
}

/** A field as the project-schema query returns it. */
export interface RemoteField {
  __typename: string
  id?: string
  name?: string
  dataType?: string
  options?: FieldOption[]
  configuration?: { iterations?: FieldIteration[]; completedIterations?: FieldIteration[] }
}

export type MappedTo = 'status' | 'priority' | 'due'

/** A ProjectField row, less its ids. */
export interface FieldDefinition {
  remoteId: string
  name: string
  dataType: FieldDataType
  options: FieldOption[] | null
  iterations: FieldIteration[] | null
  mappedTo: MappedTo | null
  position: number
}

/** The part of the binding that says which fields are mapped to Task columns. */
export interface MappedFieldIds {
  statusFieldId: string | null
  priorityFieldId: string | null
  dueFieldId: string | null
}

function mappedTo(remoteId: string, binding: MappedFieldIds): MappedTo | null {
  if (remoteId === binding.statusFieldId) return 'status'
  if (remoteId === binding.priorityFieldId) return 'priority'
  if (remoteId === binding.dueFieldId) return 'due'
  return null
}

export function normaliseFields(fields: RemoteField[], binding: MappedFieldIds): FieldDefinition[] {
  const kept: FieldDefinition[] = []
  for (const field of fields) {
    const dataType = field.dataType ? DATA_TYPE[field.dataType] : undefined
    if (!dataType || !field.id || !field.name) continue
    kept.push({
      remoteId: field.id,
      name: field.name,
      dataType,
      options:
        dataType === 'single_select'
          ? (field.options ?? []).map(o => ({ id: o.id, name: o.name, color: o.color ?? null, description: o.description ?? null }))
          : null,
      iterations:
        dataType === 'iteration'
          ? [...(field.configuration?.completedIterations ?? []), ...(field.configuration?.iterations ?? [])].map(i => ({
              id: i.id,
              title: i.title,
              startDate: i.startDate,
              duration: i.duration,
            }))
          : null,
      mappedTo: mappedTo(field.id, binding),
      position: kept.length,
    })
  }
  return kept
}

// ── Schema plan ─────────────────────────────────────────────────────────────

export interface HeldField extends Omit<FieldDefinition, 'dataType' | 'mappedTo'> {
  id: string
  dataType: string
  mappedTo: string | null
}

export interface FieldSchemaPlan {
  create: FieldDefinition[]
  update: Array<{ id: string; data: FieldDefinition }>
  /** ProjectField ids GitHub no longer has. Their values go with them. */
  remove: string[]
}

function sameDefinition(remote: FieldDefinition, held: HeldField): boolean {
  return (
    remote.name === held.name &&
    remote.dataType === held.dataType &&
    remote.mappedTo === held.mappedTo &&
    remote.position === held.position &&
    JSON.stringify(remote.options) === JSON.stringify(held.options ?? null) &&
    JSON.stringify(remote.iterations) === JSON.stringify(held.iterations ?? null)
  )
}

export function planFieldSchema(remote: FieldDefinition[], held: HeldField[]): FieldSchemaPlan {
  const heldByRemoteId = new Map(held.map(field => [field.remoteId, field]))
  const plan: FieldSchemaPlan = { create: [], update: [], remove: [] }
  for (const field of remote) {
    const existing = heldByRemoteId.get(field.remoteId)
    if (!existing) plan.create.push(field)
    else if (!sameDefinition(field, existing)) plan.update.push({ id: existing.id, data: field })
  }
  const live = new Set(remote.map(field => field.remoteId))
  plan.remove = held.filter(field => !live.has(field.remoteId)).map(field => field.id)
  return plan
}

// ── Values ──────────────────────────────────────────────────────────────────

/** A value as clients see it: text, a number, a YYYY-MM-DD date, an option id or an iteration id. */
export type FieldScalar = string | number

/** A ProjectField row as the value reader needs it. */
export interface KnownField {
  id: string
  remoteId: string
  dataType: string
  mappedTo: string | null
  options: Array<{ id: string }> | null
  iterations: Array<{ id: string }> | null
}

export interface RemoteFieldValues {
  /** ProjectField.id → value. Mapped fields are never here. */
  values: Map<string, FieldScalar>
  /** A field, option or iteration the board has not met: refresh its schema (§9.4.2). */
  unknown: boolean
  /** False when the read may have been cut short: add and change, never clear. */
  complete: boolean
}

type ValueNode = RemoteProjectItem['fieldValues']['nodes'][number] & {
  field?: { id: string; dataType?: string }
  text?: string
  number?: number
  date?: string
  optionId?: string
  iterationId?: string
}

function scalarFor(dataType: string, node: ValueNode): FieldScalar | undefined {
  switch (dataType) {
    case 'text':
      return node.text
    case 'number':
      return node.number
    case 'date':
      return node.date
    case 'single_select':
      return node.optionId
    case 'iteration':
      return node.iterationId
    default:
      return undefined
  }
}

function metBefore(field: KnownField, value: FieldScalar): boolean {
  const choices = field.dataType === 'single_select' ? field.options : field.dataType === 'iteration' ? field.iterations : null
  return !choices || choices.some(choice => choice.id === value)
}

export function remoteFieldValues(item: RemoteProjectItem, fields: Map<string, KnownField>): RemoteFieldValues {
  const nodes = item.fieldValues.nodes as ValueNode[]
  const values = new Map<string, FieldScalar>()
  let unknown = false

  for (const node of nodes) {
    const remoteId = node.field?.id
    if (!remoteId) continue // a built-in value the fragment reads no field for
    const field = fields.get(remoteId)
    if (!field) {
      // Title is a text value too: only a type Astrid keeps can be a missing field.
      if (node.field?.dataType && DATA_TYPE[node.field.dataType]) unknown = true
      continue
    }
    if (field.mappedTo) continue
    const value = scalarFor(field.dataType, node)
    if (value === undefined || value === null || value === '') continue
    values.set(field.id, value)
    if (!metBefore(field, value)) unknown = true
  }

  return { values, unknown, complete: nodes.length < FIELD_VALUES_PER_ITEM }
}

/**
 * Could this item hold a value the replica stores? Answers without the board's
 * schema, so an item carrying only GitHub's built-ins (Title, Repository) and
 * the binding's mapped fields costs no field read at all (AWTD-1297). A value
 * whose field type was not read is assumed to count, as is a cut-short read.
 */
export function carriesFieldValues(item: RemoteProjectItem, binding: MappedFieldIds): boolean {
  const nodes = item.fieldValues.nodes as ValueNode[]
  if (nodes.length >= FIELD_VALUES_PER_ITEM) return true
  const mapped = new Set([binding.statusFieldId, binding.priorityFieldId, binding.dueFieldId])
  return nodes.some(node => {
    const remoteId = node.field?.id
    if (!remoteId || mapped.has(remoteId)) return false
    return !node.field?.dataType || Boolean(DATA_TYPE[node.field.dataType])
  })
}

export interface FieldValuePlan {
  set: Array<[fieldId: string, value: FieldScalar]>
  clear: string[]
}

export function planFieldValues(remote: Pick<RemoteFieldValues, 'values' | 'complete'>, held: Map<string, FieldScalar>): FieldValuePlan {
  const set = [...remote.values].filter(([fieldId, value]) => held.get(fieldId) !== value)
  const clear = remote.complete ? [...held.keys()].filter(fieldId => !remote.values.has(fieldId)) : []
  return { set, clear }
}

// ── Columns ─────────────────────────────────────────────────────────────────

/** A TaskFieldValue row's value columns: exactly one is set. */
export interface ValueColumns {
  text: string | null
  number: number | null
  date: Date | null
  optionId: string | null
  iterationId: string | null
}

export function valueColumns(dataType: string, value: FieldScalar): ValueColumns {
  const columns: ValueColumns = { text: null, number: null, date: null, optionId: null, iterationId: null }
  if (dataType === 'number') columns.number = Number(value)
  else if (dataType === 'date') columns.date = new Date(`${value}T00:00:00.000Z`)
  else if (dataType === 'single_select') columns.optionId = String(value)
  else if (dataType === 'iteration') columns.iterationId = String(value)
  else columns.text = String(value)
  return columns
}

export function scalarOf(row: ValueColumns): FieldScalar | null {
  if (row.date) return row.date.toISOString().slice(0, 10)
  return row.optionId ?? row.iterationId ?? row.number ?? row.text
}

// ── Writing one value back (AWTD-1209, P6a-3) ───────────────────────────────

/**
 * Why a value was not written. Each becomes a named 400 on
 * `PUT /api/v1/tasks/:id/fields/:fieldId`, never a silent drop.
 */
export type FieldWriteRefusal =
  | 'field_is_mapped'
  | 'field_type_mismatch'
  | 'field_option_unknown'
  | 'field_iteration_unknown'

export type FieldWritePlan =
  | { refused: FieldWriteRefusal }
  /** `value` is GitHub's `ProjectV2FieldValue` input, null to clear; `scalar` is what the replica stores. */
  | { value: Record<string, unknown> | null; scalar: FieldScalar | null }

/** GitHub stores a date field as a calendar day, so only that form is accepted. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false
  // Rejects 2026-13-01 and 2026-02-31, which the pattern alone would admit.
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * One field value, validated against its definition before anything is sent
 * (§9.4.2).
 *
 * Pure, and checked here rather than at the route for the reason `createTask`
 * already refuses an impossible lane up front: a value GitHub would reject
 * should cost a 400, not a failed round trip that leaves the replica unsure
 * whether the write landed.
 *
 * **A mapped field is always refused**, including a clear. Status, priority
 * and due live in native Task columns — `normaliseFields` deliberately keeps
 * no `TaskFieldValue` for them — so writing one here would create a second
 * spelling of a fact that already has one. They are edited through the Task
 * column instead.
 */
export function planFieldValueWrite(field: FieldDefinition, value: unknown): FieldWritePlan {
  if (field.mappedTo) return { refused: 'field_is_mapped' }
  if (value === null) return { value: null, scalar: null }

  switch (field.dataType) {
    case 'text':
      return typeof value === 'string' ? { value: { text: value }, scalar: value } : { refused: 'field_type_mismatch' }

    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { value: { number: value }, scalar: value }
        : { refused: 'field_type_mismatch' }

    case 'date':
      return typeof value === 'string' && isCalendarDay(value)
        ? { value: { date: value }, scalar: value }
        : { refused: 'field_type_mismatch' }

    case 'single_select':
      if (typeof value !== 'string') return { refused: 'field_type_mismatch' }
      return (field.options ?? []).some(option => option.id === value)
        ? { value: { singleSelectOptionId: value }, scalar: value }
        : { refused: 'field_option_unknown' }

    case 'iteration':
      if (typeof value !== 'string') return { refused: 'field_type_mismatch' }
      return (field.iterations ?? []).some(iteration => iteration.id === value)
        ? { value: { iterationId: value }, scalar: value }
        : { refused: 'field_iteration_unknown' }

    default:
      return { refused: 'field_type_mismatch' }
  }
}
