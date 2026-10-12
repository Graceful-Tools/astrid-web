/**
 * `fields` on a v1 task — a GitHub project's field values, compactly (AWTD-1208).
 *
 * Spec §9.4.3. The shape is `{ "<ProjectField.id>": <scalar | optionId |
 * iterationId> }`: no names, no types, no nulls, and no key at all on a task
 * that has no values. Names and types are served once per project by
 * `GET /api/v1/projects/:id/fields`, which is the whole reason this is small.
 *
 * **Why values do NOT ride list responses.** Measured 2026-10-12 with
 * `scripts/measure-api-latency.ts`: a thousand tasks carrying eight fields each
 * adds **42.2 KiB** to the gzipped response. The eight field ids repeat across
 * every task so gzip removes most of the bytes — the uncompressed cost is about
 * 440 KB — but the full task response is already 551.8 KiB on the wire against
 * a 500 KiB budget, so there is no headroom to spend. The spec's own rule
 * decides it: *"The budget wins over convenience."*
 *
 * So the list route carries them only when asked (`?include=fields`), and the
 * detail route always does — one task's eight entries are a few hundred bytes.
 *
 * **Why this is separate from lib/github/projects/fields.ts.** That module is
 * the pure GitHub mapping, with no idea what a wire payload is. This one knows
 * only the v1 shape and borrows `scalarOf` for the one rule they share: which
 * column of a row holds the value.
 */

import { scalarOf, type ValueColumns } from '@/lib/github/projects/fields'
import { hasCapability } from '@/lib/brand/capabilities'

/** A TaskFieldValue row as the payload reads it. */
export type TaskFieldValueRow = ValueColumns & { fieldId: string }

/** What `fields` is on the wire. A task with no values carries no key. */
export type V1TaskFields = Record<string, string | number>

/**
 * Whether this deployment serves project fields at all.
 *
 * Read once at module load, like `withAuth`'s capability gate: capabilities are
 * build-time constants, so this costs nothing per request.
 *
 * **It gates the QUERY and only the query.** The shaping functions below are
 * deliberately free of it: with the capability off the relation is absent from
 * the select, so there are no rows, so there is no `fields` key — one gate, in
 * the one place that can actually make the deployment pay. Checking it again
 * while mapping rows would be a second gate that can only ever disagree with
 * the first, and it would make the mapping untestable without setting a brand
 * environment variable to test a pure function about five nullable columns.
 */
export const SERVES_PROJECT_FIELDS = hasCapability('githubProjects')

/**
 * The `fieldValues` select to spread into a task query, or `{}` when the
 * capability is off or the caller did not ask for fields.
 *
 * Spreading `{}` is what keeps the promise that *"a deployment without the
 * capability must pay no extra query"* — the relation is absent from the query
 * Prisma builds, not merely unread.
 */
export function taskFieldValuesSelect(wanted: boolean = true) {
  if (!SERVES_PROJECT_FIELDS || !wanted) return {} as const
  return {
    fieldValues: {
      select: {
        fieldId: true,
        text: true,
        number: true,
        date: true,
        optionId: true,
        iterationId: true,
      },
    },
  } as const
}

/**
 * The compact `fields` object for one task, or undefined when there is nothing
 * to say — no rows, or every row empty (which includes every deployment and
 * every request where the relation was never selected).
 *
 * Undefined rather than `{}` on purpose: the key is then spread away entirely,
 * so a task outside a GitHub board looks exactly as it did before this existed.
 */
export function v1TaskFields(rows: TaskFieldValueRow[] | undefined | null): V1TaskFields | undefined {
  if (!rows || rows.length === 0) return undefined

  const fields: V1TaskFields = {}
  for (const row of rows) {
    const value = scalarOf(row)
    // A row exists only because it had a value, but a cleared one can race the
    // read. No nulls on the wire, per the spec.
    if (value === null || value === undefined) continue
    fields[row.fieldId] = value
  }
  return Object.keys(fields).length > 0 ? fields : undefined
}

/**
 * `{ fields }` or `{}`, ready to spread into a task payload.
 *
 * The spread form is the one every call site wants, and writing
 * `...(f ? { fields: f } : {})` at each of them is how one of them ends up
 * emitting `fields: undefined` — which `JSON.stringify` drops from an object
 * but not from an array element, so it would reach a client as `null`.
 */
export function v1TaskFieldsPatch(rows: TaskFieldValueRow[] | undefined | null): { fields?: V1TaskFields } {
  const fields = v1TaskFields(rows)
  return fields ? { fields } : {}
}
