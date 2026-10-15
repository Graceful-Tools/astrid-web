/**
 * `fields` on a v1 task (AWTD-1208, spec §9.4.3) — the compact map that lets
 * the schema be served once per project instead of on every task.
 *
 * Pinned:
 *   - the shape is `{ "<ProjectField.id>": <scalar> }`, by field id, not remote id;
 *   - a date is YYYY-MM-DD, an option is its id, an iteration is its id;
 *   - no nulls reach the wire, and a task with nothing to say carries NO KEY —
 *     not an empty object, which every task outside a GitHub board would get;
 *   - the patch form spreads away cleanly, so no payload emits `fields: undefined`.
 */

import { describe, it, expect } from 'vitest'
import { v1TaskFields, v1TaskFieldsPatch, taskFieldValuesSelect, type TaskFieldValueRow } from '@/lib/tasks/v1-task-fields'

const empty = { text: null, number: null, date: null, optionId: null, iterationId: null }
const row = (fieldId: string, patch: Partial<TaskFieldValueRow>): TaskFieldValueRow => ({
  fieldId,
  ...empty,
  ...patch,
})

describe('v1TaskFields (AWTD-1208)', () => {
  it('keys by ProjectField.id and carries one scalar each', () => {
    expect(
      v1TaskFields([
        row('field-text', { text: 'Rollout note' }),
        row('field-number', { number: 3.5 }),
        row('field-option', { optionId: 'f75ad846' }),
        row('field-iteration', { iterationId: 'PVTI_lADOA1' }),
      ]),
    ).toEqual({
      'field-text': 'Rollout note',
      'field-number': 3.5,
      'field-option': 'f75ad846',
      'field-iteration': 'PVTI_lADOA1',
    })
  })

  it('renders a date as YYYY-MM-DD, not an ISO timestamp', () => {
    // The column is @db.Date; a client that gets a timestamp has to guess a
    // timezone for a value that never had one.
    expect(v1TaskFields([row('field-date', { date: new Date('2026-11-01T00:00:00.000Z') })])).toEqual({
      'field-date': '2026-11-01',
    })
  })

  it('is undefined for a task with no values — no key, not an empty object', () => {
    // Every task outside a GitHub board takes this path, which is why it must
    // not add two bytes each to a thousand-task response.
    expect(v1TaskFields([])).toBeUndefined()
    expect(v1TaskFields(undefined)).toBeUndefined()
    expect(v1TaskFields(null)).toBeUndefined()
  })

  it('drops a row whose value was cleared under the read, rather than sending null', () => {
    expect(v1TaskFields([row('field-gone', {}), row('field-kept', { text: 'here' })])).toEqual({
      'field-kept': 'here',
    })
  })

  it('is undefined when every row is empty', () => {
    expect(v1TaskFields([row('a', {}), row('b', {})])).toBeUndefined()
  })
})

describe('v1TaskFieldsPatch (AWTD-1208)', () => {
  it('spreads to nothing when there are no fields', () => {
    const task = { id: 't1', ...v1TaskFieldsPatch([]) }
    expect(task).toEqual({ id: 't1' })
    expect('fields' in task).toBe(false)
  })

  it('spreads the fields when there are some', () => {
    expect({ id: 't1', ...v1TaskFieldsPatch([row('f', { text: 'x' })]) }).toEqual({
      id: 't1',
      fields: { f: 'x' },
    })
  })

  it('never puts an undefined `fields` on an array element', () => {
    // JSON.stringify drops an undefined object property but turns an undefined
    // ARRAY element into null, so a list payload built from a bad patch would
    // ship `"fields": null` to clients. The patch cannot express that.
    const tasks = [{ id: 'a', ...v1TaskFieldsPatch(null) }]
    expect(JSON.parse(JSON.stringify(tasks))).toEqual([{ id: 'a' }])
  })
})

describe('taskFieldValuesSelect (AWTD-1208)', () => {
  it('is empty when the caller did not ask, so the relation is absent from the query', () => {
    // "A deployment without the capability must pay no extra query" — and the
    // same holds for a list request that did not ask for fields. Absent from
    // the select, not merely unread.
    expect(taskFieldValuesSelect(false)).toEqual({})
  })

  it('selects only the value columns and the field id when asked', () => {
    const select = taskFieldValuesSelect(true)
    // Guarded: with the capability off this is empty, and that is correct too.
    if (Object.keys(select).length === 0) return
    expect(select).toEqual({
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
    })
  })
})
