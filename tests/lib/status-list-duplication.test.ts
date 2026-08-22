/**
 * RED-first regression tests for the duplicate-status-list bug.
 *
 * Cause: migration 20260731010000_project_scoped_statuses created a
 * Ready/Doing/Waiting set PER PROJECT, on top of the per-user set that
 * 20260516000000_per_user_status_lists had consolidated to exactly one. A user
 * with two boards ended up with nine status lists instead of three, and they
 * surfaced as duplicates in every list picker.
 *
 * **Stage D (task b7b0c2f5) removed the class of bug, not just the instance:**
 * board columns are config plus `Project.customStates`, so there is no set of
 * rows left to duplicate and `statusListsForUser` — whose whole job was
 * collapsing them — is gone. The suites that pinned its deduplication went
 * with it.
 *
 * What is still worth pinning is the picker rule, because a status row can
 * still arrive in a client's list set from a cache written before the deploy,
 * and it must never be offered as a destination.
 */

import { describe, it, expect } from 'vitest'
import { filterDomainLists, isDomainList } from '@/lib/list-flavors'
import { selectableLists } from '@/lib/status-lists'

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

/**
 * Custom states are a per-PROJECT, Project-Mode-only feature; the default
 * Ready/Doing/Waiting stay per-user singletons that span every board.
 *
 * So the two kinds of status list are scoped differently on purpose, and the
 * cleanup must not confuse them.
 */
