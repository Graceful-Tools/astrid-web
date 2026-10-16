/**
 * AWTD-1210 (P6a-4): which project fields the task detail pane shows, in what
 * order, and how an iteration field's choices are ordered.
 *
 * Spec §9.4, decision D4. Two rules are easy to get wrong and both are pure,
 * so they are pinned here rather than inside a component:
 *
 *   - a MAPPED field never renders. Status, priority and due are native Task
 *     columns with their own rows already; rendering them again would offer two
 *     controls for one value, and AWTD-1209 refuses the write anyway.
 *   - an iteration's CURRENT and UPCOMING choices come first, with completed
 *     ones still readable below. GitHub returns completed iterations in the
 *     same array, and a year-old sprint should not sit above this week's.
 */
import { describe, expect, it } from 'vitest'
import { visibleProjectFields, orderIterationChoices } from '@/lib/project-field-display'
import type { ProjectFieldSchemaEntry } from '@/lib/project-field-display'

const field = (over: Partial<ProjectFieldSchemaEntry>): ProjectFieldSchemaEntry => ({
  id: 'f1',
  remoteId: 'PVTF_1',
  name: 'Field',
  dataType: 'text',
  options: null,
  iterations: null,
  mappedTo: null,
  position: 0,
  ...over,
})

describe('visibleProjectFields (AWTD-1210)', () => {
  it('drops mapped fields — they have native Task rows already', () => {
    const fields = [
      field({ id: 'a', name: 'Notes', position: 1 }),
      field({ id: 'b', name: 'Status', mappedTo: 'status', position: 0 }),
      field({ id: 'c', name: 'Priority', mappedTo: 'priority', position: 2 }),
      field({ id: 'd', name: 'Ship', mappedTo: 'due', position: 3 }),
    ]
    expect(visibleProjectFields(fields).map(f => f.id)).toEqual(['a'])
  })

  it('orders by position, not by name or by arrival', () => {
    const fields = [
      field({ id: 'c', name: 'Zebra', position: 2 }),
      field({ id: 'a', name: 'Apple', position: 0 }),
      field({ id: 'b', name: 'Mango', position: 1 }),
    ]
    expect(visibleProjectFields(fields).map(f => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('an unknown dataType is dropped rather than rendered without an editor', () => {
    // The server only ever sends the five it normalises, but a newer server
    // talking to an older client is exactly when a blank row would appear.
    const fields = [field({ id: 'a' }), field({ id: 'b', dataType: 'tracks' })]
    expect(visibleProjectFields(fields).map(f => f.id)).toEqual(['a'])
  })

  it('no fields at all is an empty list, not a thrown error', () => {
    expect(visibleProjectFields([])).toEqual([])
    expect(visibleProjectFields(undefined)).toEqual([])
  })
})

describe('orderIterationChoices (AWTD-1210)', () => {
  const today = new Date('2026-10-16T00:00:00Z')
  const iterations = [
    { id: 'old', title: 'Sprint 1', startDate: '2026-09-01', duration: 14 },
    { id: 'now', title: 'Sprint 3', startDate: '2026-10-12', duration: 14 },
    { id: 'next', title: 'Sprint 4', startDate: '2026-10-26', duration: 14 },
  ]

  it('puts current and upcoming first, completed last but still present', () => {
    const ordered = orderIterationChoices(iterations, today)
    expect(ordered.map(i => i.id)).toEqual(['now', 'next', 'old'])
    // Completed ones stay readable: a task already pointing at one must still
    // render its title rather than a bare id.
    expect(ordered.find(i => i.id === 'old')?.completed).toBe(true)
    expect(ordered.find(i => i.id === 'now')?.completed).toBe(false)
  })

  it('an iteration ending today is still current, not completed', () => {
    // startDate 2026-10-12 + 14 days runs through 2026-10-25.
    const ordered = orderIterationChoices([iterations[1]], new Date('2026-10-25T23:00:00Z'))
    expect(ordered[0].completed).toBe(false)
  })

  it('the day after it ends, it is completed', () => {
    const ordered = orderIterationChoices([iterations[1]], new Date('2026-10-26T00:00:00Z'))
    expect(ordered[0].completed).toBe(true)
  })

  it('no iterations is an empty list', () => {
    expect(orderIterationChoices(null, today)).toEqual([])
  })
})
