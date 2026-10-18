/**
 * AWTD-1259 (P6a-5): filtering a GitHub board by one project field.
 *
 * Spec §9.4, decision D4 — "filterable on the board". Jon chose storage (a):
 * one scalar `filterProjectField` view preference holding "<fieldId>:<valueId>".
 *
 * The rules pinned here are the ones that would otherwise hide inside a
 * component:
 *
 *   - only UNMAPPED single-select and iteration fields are filterable. A field
 *     mapped to status/priority already has its native filter or column.
 *   - a stale filter (field deleted on GitHub, option renamed away) RESOLVES TO
 *     NOTHING rather than to "match nothing" — a saved preference must never be
 *     able to blank a board with no visible reason.
 *   - a task with no value for the field does not match a value.
 */
import { describe, expect, it } from 'vitest'
import {
  filterableProjectFields,
  formatProjectFieldFilter,
  githubBoardListFor,
  matchesProjectFieldFilter,
  projectFieldFilterGroups,
  projectFieldValuesOf,
  parseProjectFieldFilter,
  resolveProjectFieldFilter,
} from '@/lib/project-field-filter'
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

const area = field({
  id: 'area',
  name: 'Area',
  dataType: 'single_select',
  options: [{ id: 'opt-web', name: 'Web' }, { id: 'opt-ios', name: 'iOS' }],
  position: 2,
})
const sprint = field({
  id: 'sprint',
  name: 'Sprint',
  dataType: 'iteration',
  iterations: [{ id: 'it-1', title: 'Sprint 1', startDate: '2026-10-01', duration: 14 }],
  position: 1,
})
const status = field({
  id: 'status',
  name: 'Status',
  dataType: 'single_select',
  options: [{ id: 'opt-todo', name: 'Todo' }],
  mappedTo: 'status',
})
const notes = field({ id: 'notes', name: 'Notes', dataType: 'text' })

describe('AWTD-1259: filterableProjectFields', () => {
  it('offers unmapped single-select and iteration fields, in position order', () => {
    expect(filterableProjectFields([area, notes, status, sprint]).map(f => f.id)).toEqual(['sprint', 'area'])
  })

  it('is empty for a missing schema', () => {
    expect(filterableProjectFields(undefined)).toEqual([])
  })
})

describe('AWTD-1259: the stored value', () => {
  it('round-trips "<fieldId>:<valueId>"', () => {
    const raw = formatProjectFieldFilter('area', 'opt-web')
    expect(raw).toBe('area:opt-web')
    expect(parseProjectFieldFilter(raw)).toEqual({ fieldId: 'area', valueId: 'opt-web' })
  })

  it('splits on the FIRST colon, so a value id containing one survives', () => {
    expect(parseProjectFieldFilter('area:a:b')).toEqual({ fieldId: 'area', valueId: 'a:b' })
  })

  it.each([null, undefined, '', 'all', 'area', ':x', 'area:'])('treats %p as no filter', raw => {
    expect(parseProjectFieldFilter(raw)).toBeNull()
  })
})

describe('AWTD-1259: resolveProjectFieldFilter', () => {
  const schema = [area, sprint, status]

  it('resolves a live single-select option', () => {
    expect(resolveProjectFieldFilter('area:opt-ios', schema)).toEqual({ fieldId: 'area', valueId: 'opt-ios' })
  })

  it('resolves a live iteration', () => {
    expect(resolveProjectFieldFilter('sprint:it-1', schema)).toEqual({ fieldId: 'sprint', valueId: 'it-1' })
  })

  it('drops a filter whose field no longer exists', () => {
    expect(resolveProjectFieldFilter('gone:opt-web', schema)).toBeNull()
  })

  it('drops a filter whose option no longer exists', () => {
    expect(resolveProjectFieldFilter('area:opt-deleted', schema)).toBeNull()
  })

  it('drops a filter on a MAPPED field', () => {
    expect(resolveProjectFieldFilter('status:opt-todo', schema)).toBeNull()
  })

  it('drops everything while the schema is not loaded', () => {
    expect(resolveProjectFieldFilter('area:opt-web', [])).toBeNull()
  })
})

describe('AWTD-1259: projectFieldFilterGroups', () => {
  it('lists each filterable field with choices carrying the stored value', () => {
    const groups = projectFieldFilterGroups([area, sprint, status, notes], new Date('2026-10-05T00:00:00Z'))

    expect(groups).toEqual([
      { fieldId: 'sprint', fieldName: 'Sprint', choices: [{ value: 'sprint:it-1', label: 'Sprint 1' }] },
      {
        fieldId: 'area',
        fieldName: 'Area',
        choices: [
          { value: 'area:opt-web', label: 'Web' },
          { value: 'area:opt-ios', label: 'iOS' },
        ],
      },
    ])
  })

  it('drops a field with nothing to pick', () => {
    expect(projectFieldFilterGroups([field({ id: 'e', dataType: 'single_select', options: [] })])).toEqual([])
  })
})

describe('AWTD-1259: githubBoardListFor', () => {
  const lists = [
    { id: 'local', projectId: 'p1', backend: null },
    { id: 'gh', projectId: 'p1', backend: 'github_project' },
    { id: 'other', projectId: 'p2', backend: 'github_project' },
  ]

  it("finds the project's GitHub-backed list", () => {
    expect(githubBoardListFor(lists, 'p1')?.id).toBe('gh')
  })

  it('is null for a local board or no project', () => {
    expect(githubBoardListFor([lists[0]], 'p1')).toBeNull()
    expect(githubBoardListFor(lists, null)).toBeNull()
  })
})

describe('AWTD-1259: projectFieldValuesOf', () => {
  const fetched = new Map([['t1', { area: 'opt-ios' }]])

  it("prefers the task's own fields — an edit made this session is newer than the fetch", () => {
    expect(projectFieldValuesOf({ id: 't1', fields: { area: 'opt-web' } }, fetched)).toEqual({ area: 'opt-web' })
  })

  it('falls back to the fetched map for a task the bulk sync loaded without fields', () => {
    expect(projectFieldValuesOf({ id: 't1' }, fetched)).toEqual({ area: 'opt-ios' })
  })
})

describe('AWTD-1259: matchesProjectFieldFilter', () => {
  const filter = { fieldId: 'area', valueId: 'opt-web' }

  it('matches a task carrying that value', () => {
    expect(matchesProjectFieldFilter({ area: 'opt-web' }, filter)).toBe(true)
  })

  it('rejects a task carrying another value', () => {
    expect(matchesProjectFieldFilter({ area: 'opt-ios' }, filter)).toBe(false)
  })

  it('rejects a task with no value for the field, or no fields at all', () => {
    expect(matchesProjectFieldFilter({ sprint: 'it-1' }, filter)).toBe(false)
    expect(matchesProjectFieldFilter(undefined, filter)).toBe(false)
    expect(matchesProjectFieldFilter(null, filter)).toBe(false)
  })

  it('keeps everything when there is no filter', () => {
    expect(matchesProjectFieldFilter(undefined, null)).toBe(true)
  })
})
