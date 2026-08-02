/**
 * RED-first regression tests for the duplicate-status-list bug.
 *
 * Cause: migration 20260731010000_project_scoped_statuses created a
 * Ready/Doing/Waiting set PER PROJECT, on top of the per-user set that
 * 20260516000000_per_user_status_lists had consolidated to exactly one. A user
 * with two boards ended up with nine status lists instead of three, and they
 * surface as duplicates in every list picker.
 *
 * That is the precise problem the 20260516 migration existed to remove
 * ("dozens of duplicate status lists for users with many boards — unscalable").
 *
 * The rule these pin: **a user has exactly one Ready / Doing / Waiting, full
 * stop**, and status lists are never offered as a destination.
 */

import { describe, it, expect } from 'vitest'
import { filterDomainLists, isDomainList } from '@/lib/list-flavors'
import { selectableLists, statusListsForUser } from '@/lib/status-lists'

const status = (id: string, role: string, ownerId: string, projectId: string | null) => ({
  id, name: role[0].toUpperCase() + role.slice(1), listType: 'status',
  statusRole: role, ownerId, projectId, privacy: 'PRIVATE',
}) as never

const regular = (id: string, name: string) =>
  ({ id, name, listType: 'regular', ownerId: 'jon', projectId: null, privacy: 'PRIVATE' }) as never

// What Jon's account actually looked like in production after the bad migration.
const jonsLists = [
  regular('web', 'Astrid Web To-do'),
  regular('ios', 'Astrid iOS To-do'),
  status('personal-ready', 'ready', 'jon', null),
  status('personal-doing', 'doing', 'jon', null),
  status('personal-waiting', 'waiting', 'jon', null),
  status('web-ready', 'ready', 'jon', 'project-web'),
  status('web-doing', 'doing', 'jon', 'project-web'),
  status('web-waiting', 'waiting', 'jon', 'project-web'),
  status('ios-ready', 'ready', 'jon', 'project-ios'),
  status('ios-doing', 'doing', 'jon', 'project-ios'),
  status('ios-waiting', 'waiting', 'jon', 'project-ios'),
]

describe('a user has exactly one status list per role', () => {
  it('REGRESSION: statusListsForUser collapses the duplicates to three', () => {
    const statuses = statusListsForUser(jonsLists)
    expect(statuses).toHaveLength(3)
    expect(statuses.map(s => s.statusRole).sort()).toEqual(['doing', 'ready', 'waiting'])
  })

  it('prefers the durable per-user set over the per-project duplicates', () => {
    // The per-user rows are the ones that survive; the project-scoped rows are
    // what the bad migration added and what the cleanup removes.
    expect(statusListsForUser(jonsLists).map(s => s.id).sort())
      .toEqual(['personal-doing', 'personal-ready', 'personal-waiting'])
  })

  it('still returns a set when only per-project rows exist (mid-cleanup)', () => {
    const partial = jonsLists.filter(l => !String((l as { id: string }).id).startsWith('personal-'))
    const statuses = statusListsForUser(partial)
    expect(statuses).toHaveLength(3)
    expect(new Set(statuses.map(s => s.statusRole)).size).toBe(3)
  })
})

describe('status lists are never offered as a destination', () => {
  it('REGRESSION: the list picker offers no status lists at all', () => {
    // This is what the user sees: typing in the Lists field offered three
    // "Ready", three "Doing" and three "Waiting".
    const options = selectableLists(jonsLists)
    expect(options.every(isDomainList)).toBe(true)
    expect(options.map(l => (l as { id: string }).id)).toEqual(['web', 'ios'])
  })

  it('drops virtual lists too, as the picker always did', () => {
    const withVirtual = [...jonsLists, { id: 'today', name: 'Today', listType: 'regular', isVirtual: true } as never]
    expect(selectableLists(withVirtual).map(l => (l as { id: string }).id)).toEqual(['web', 'ios'])
  })

  it('filterDomainLists already excluded them — the picker just never called it', () => {
    expect(filterDomainLists(jonsLists)).toHaveLength(2)
  })
})
