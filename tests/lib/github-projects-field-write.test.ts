/**
 * AWTD-1209 (P6a-3): validating a field value before it is written to GitHub.
 *
 * Spec §9.4.2. The validation is pure and happens BEFORE the mutation, for the
 * same reason `planInitialFields` refuses an impossible lane before anything
 * exists on GitHub: a value GitHub will reject should cost a 400, not a failed
 * round trip that leaves the replica guessing.
 *
 * A MAPPED field (status, priority, due) is refused here rather than written.
 * Its value lives in a native Task column, so accepting it on this route would
 * put two spellings of one fact in play — the rule `fields.ts` already states
 * for the read side ("there is one source per value").
 */
import { describe, expect, it } from 'vitest'
import { planFieldValueWrite, type FieldDefinition } from '@/lib/github/projects/fields'

const base: Omit<FieldDefinition, 'dataType' | 'options' | 'iterations'> = {
  remoteId: 'PVTF_text',
  name: 'Notes',
  mappedTo: null,
  position: 0,
}

const text: FieldDefinition = { ...base, dataType: 'text', options: null, iterations: null }
const number: FieldDefinition = { ...base, remoteId: 'PVTF_num', name: 'Estimate', dataType: 'number', options: null, iterations: null }
const date: FieldDefinition = { ...base, remoteId: 'PVTF_date', name: 'Ship', dataType: 'date', options: null, iterations: null }
const select: FieldDefinition = {
  ...base,
  remoteId: 'PVTF_sel',
  name: 'Size',
  dataType: 'single_select',
  options: [{ id: 'opt_s', name: 'S', color: null, description: null }],
  iterations: null,
}
const iteration: FieldDefinition = {
  ...base,
  remoteId: 'PVTF_iter',
  name: 'Sprint',
  dataType: 'iteration',
  options: null,
  iterations: [{ id: 'iter_1', title: 'Sprint 1', startDate: '2026-10-01', duration: 14 }],
}

describe('planFieldValueWrite — the value GitHub will be sent (AWTD-1209)', () => {
  it('text, number and date become their ProjectV2FieldValue input', () => {
    expect(planFieldValueWrite(text, 'hello')).toEqual({ value: { text: 'hello' }, scalar: 'hello' })
    expect(planFieldValueWrite(number, 3)).toEqual({ value: { number: 3 }, scalar: 3 })
    expect(planFieldValueWrite(date, '2026-10-16')).toEqual({ value: { date: '2026-10-16' }, scalar: '2026-10-16' })
  })

  it('a select sends the option id, and an iteration the iteration id', () => {
    expect(planFieldValueWrite(select, 'opt_s')).toEqual({ value: { singleSelectOptionId: 'opt_s' }, scalar: 'opt_s' })
    expect(planFieldValueWrite(iteration, 'iter_1')).toEqual({ value: { iterationId: 'iter_1' }, scalar: 'iter_1' })
  })

  it('null clears the field', () => {
    expect(planFieldValueWrite(text, null)).toEqual({ value: null, scalar: null })
    expect(planFieldValueWrite(select, null)).toEqual({ value: null, scalar: null })
  })

  it('a mapped field is refused — its value belongs to the Task column', () => {
    for (const mapped of ['status', 'priority', 'due'] as const) {
      expect(planFieldValueWrite({ ...select, mappedTo: mapped }, 'opt_s')).toEqual({ refused: 'field_is_mapped' })
    }
    // Clearing one is refused too: the refusal is about the field, not the value.
    expect(planFieldValueWrite({ ...text, mappedTo: 'status' }, null)).toEqual({ refused: 'field_is_mapped' })
  })

  it('a value of the wrong type is refused before the round trip', () => {
    expect(planFieldValueWrite(text, 5)).toEqual({ refused: 'field_type_mismatch' })
    expect(planFieldValueWrite(number, '3')).toEqual({ refused: 'field_type_mismatch' })
    expect(planFieldValueWrite(number, Number.NaN)).toEqual({ refused: 'field_type_mismatch' })
    expect(planFieldValueWrite(select, 7)).toEqual({ refused: 'field_type_mismatch' })
  })

  it('a date must be a calendar day, since that is what GitHub stores', () => {
    expect(planFieldValueWrite(date, '2026-10-16T12:00:00Z')).toEqual({ refused: 'field_type_mismatch' })
    expect(planFieldValueWrite(date, '16/10/2026')).toEqual({ refused: 'field_type_mismatch' })
    expect(planFieldValueWrite(date, '2026-13-01')).toEqual({ refused: 'field_type_mismatch' })
  })

  it('an option or iteration the field does not define is refused, not passed through', () => {
    expect(planFieldValueWrite(select, 'opt_missing')).toEqual({ refused: 'field_option_unknown' })
    expect(planFieldValueWrite(iteration, 'iter_missing')).toEqual({ refused: 'field_iteration_unknown' })
  })
})
