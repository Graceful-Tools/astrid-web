/**
 * GitHub iterations → membership in iteration-flavor lists (AWTD-1230, P6c-3b).
 *
 * Pinned here:
 *   - an iteration list is keyed by (field, iteration), because an iteration id
 *     is only unique within its field and `remoteNodeId` is unique app-wide;
 *   - a task joins the list for each iteration value it holds and leaves every
 *     other iteration list — one value per field, like a milestone;
 *   - the window: GitHub gives a start date and a duration in days, and the
 *     last day is start + duration − 1;
 *   - Jon's decision (b), 2026-10-17: an ENDED iteration's list stays but is
 *     hidden. Ended means today is past the last day — not on it.
 */

import { describe, it, expect } from 'vitest'
import {
  isEmptyIterationPlan,
  iterationEndsOn,
  iterationListDescription,
  iterationListDrift,
  iterationListKey,
  iterationWindow,
  isIterationEnded,
  parseIterationListKey,
  planIterations,
  wantedIterations,
  type IterationField,
} from '@/lib/github/projects/iterations'

const sprint: IterationField = {
  id: 'pf-sprint',
  remoteId: 'PVTIF_sprint',
  name: 'Sprint',
  iterations: [
    { id: 'it-41', title: 'Sprint 41', startDate: '2026-10-05', duration: 14 },
    { id: 'it-42', title: 'Sprint 42', startDate: '2026-10-19', duration: 14 },
  ],
}

describe('iteration list key (AWTD-1230)', () => {
  it('names the field and the iteration, and reads back', () => {
    const key = iterationListKey('PVTIF_sprint', 'it-41')
    expect(key).toBe('PVTIF_sprint:it-41')
    expect(parseIterationListKey(key)).toEqual({ fieldRemoteId: 'PVTIF_sprint', iterationId: 'it-41' })
  })

  it('is not mistaken for a label or milestone node id', () => {
    expect(parseIterationListKey('LA_kwDOabc')).toBeNull()
    expect(parseIterationListKey(null)).toBeNull()
  })
})

describe('the iteration window (AWTD-1230)', () => {
  const it41 = sprint.iterations![0]

  it('ends on start + duration − 1', () => {
    expect(iterationEndsOn(it41)).toBe('2026-10-18')
  })

  it('is not ended ON its last day, and is the day after', () => {
    expect(isIterationEnded(it41, new Date('2026-10-18T23:00:00Z'))).toBe(false)
    expect(isIterationEnded(it41, new Date('2026-10-19T00:00:00Z'))).toBe(true)
  })

  it('the wire window says when it ends and whether it is hidden — decision (b)', () => {
    expect(iterationWindow(it41, new Date('2026-10-17T12:00:00Z'))).toEqual({
      startDate: '2026-10-05',
      endsOn: '2026-10-18',
      hidden: false,
    })
    expect(iterationWindow(it41, new Date('2026-10-20T12:00:00Z'))).toMatchObject({ hidden: true })
  })

  it('the list description carries the field and the dates', () => {
    expect(iterationListDescription('Sprint', it41)).toBe('Sprint · 2026-10-05 – 2026-10-18')
  })

  it('a renamed or re-dated iteration drifts; an unchanged one does not', () => {
    const list = { name: 'Sprint 41', description: 'Sprint · 2026-10-05 – 2026-10-18' }
    expect(iterationListDrift('Sprint', it41, list)).toBeNull()
    expect(iterationListDrift('Sprint', { ...it41, title: 'Sprint 41b', duration: 7 }, list)).toEqual({
      name: 'Sprint 41b',
      description: 'Sprint · 2026-10-05 – 2026-10-11',
    })
  })
})

describe('wantedIterations (AWTD-1230)', () => {
  const fields = new Map([[sprint.id, sprint]])

  it('maps a stored iteration value to its list key and definition', () => {
    const wanted = wantedIterations([{ fieldId: 'pf-sprint', iterationId: 'it-42' }], fields)
    expect(wanted).toEqual([{ key: 'PVTIF_sprint:it-42', field: sprint, iteration: sprint.iterations![1] }])
  })

  it('skips a value whose field or iteration the board no longer defines', () => {
    expect(wantedIterations([{ fieldId: 'pf-gone', iterationId: 'it-41' }], fields)).toEqual([])
    expect(wantedIterations([{ fieldId: 'pf-sprint', iterationId: 'it-99' }], fields)).toEqual([])
    expect(wantedIterations([{ fieldId: 'pf-sprint', iterationId: null }], fields)).toEqual([])
  })
})

describe('planIterations (AWTD-1230)', () => {
  it('joins the wanted list and leaves the old one when a task moves sprint', () => {
    const plan = planIterations(['PVTIF_sprint:it-42'], ['PVTIF_sprint:it-41'])
    expect(plan).toEqual({ join: ['PVTIF_sprint:it-42'], leave: ['PVTIF_sprint:it-41'] })
  })

  it('a task taken out of every iteration leaves them all', () => {
    expect(planIterations([], ['PVTIF_sprint:it-41'])).toEqual({ join: [], leave: ['PVTIF_sprint:it-41'] })
  })

  it('agreeing state is an empty plan', () => {
    expect(isEmptyIterationPlan(planIterations(['PVTIF_sprint:it-41'], ['PVTIF_sprint:it-41']))).toBe(true)
  })
})
