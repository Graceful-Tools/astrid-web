/**
 * What list a task's "create new list" makes (AWTD-1227).
 *
 * Extracted from `components/task-detail.tsx` to pay for the subtasks section
 * under the oversized-files ratchet — and it is the half worth testing. The
 * state plumbing around it is three setters; the part that can be WRONG is
 * which privacy a new list inherits and who administers it. Get that wrong and
 * a list meant for a shared board is created private, visible to nobody else,
 * with no error to show for it.
 *
 * Pinned:
 *   - PUBLIC beats SHARED beats PRIVATE — widest wins, because the new list has
 *     to be at least as reachable as the task's existing audience;
 *   - admins are inherited only from SHARED siblings, deduplicated;
 *   - `adminIds` is ABSENT rather than empty on a private or public list, since
 *     an empty array reads as "no admins" rather than "not applicable".
 */

import { describe, it, expect } from 'vitest'
import { inheritedListAdminIds, inheritedListPrivacy } from '@/lib/task-detail/create-list-for-task'

const list = (privacy: 'PRIVATE' | 'SHARED' | 'PUBLIC', admins: string[] = []) => ({
  privacy,
  admins: admins.map(id => ({ id })),
})

describe('inheritedListPrivacy (AWTD-1227)', () => {
  it('is PRIVATE when the task is on no lists', () => {
    expect(inheritedListPrivacy([])).toBe('PRIVATE')
  })

  it('is PRIVATE when every sibling is private', () => {
    expect(inheritedListPrivacy([list('PRIVATE'), list('PRIVATE')])).toBe('PRIVATE')
  })

  it('is SHARED when any sibling is shared', () => {
    expect(inheritedListPrivacy([list('PRIVATE'), list('SHARED')])).toBe('SHARED')
  })

  it('is PUBLIC when any sibling is public — widest wins', () => {
    // Narrowest-wins would create a list the task's own collaborators cannot
    // see, which is the failure mode worth naming.
    expect(inheritedListPrivacy([list('PUBLIC'), list('SHARED'), list('PRIVATE')])).toBe('PUBLIC')
  })
})

describe('inheritedListAdminIds (AWTD-1227)', () => {
  it('is undefined for a private list, not an empty array', () => {
    expect(inheritedListAdminIds([list('PRIVATE', ['a'])], 'PRIVATE')).toBeUndefined()
  })

  it('is undefined for a public list too', () => {
    expect(inheritedListAdminIds([list('SHARED', ['a'])], 'PUBLIC')).toBeUndefined()
  })

  it('collects admins from the SHARED siblings only', () => {
    expect(
      inheritedListAdminIds([list('SHARED', ['a', 'b']), list('PRIVATE', ['c'])], 'SHARED'),
    ).toEqual(['a', 'b'])
  })

  it('deduplicates an admin who administers two shared lists', () => {
    expect(inheritedListAdminIds([list('SHARED', ['a']), list('SHARED', ['a', 'b'])], 'SHARED')).toEqual([
      'a',
      'b',
    ])
  })

  it('is an empty array when the shared siblings have no admins', () => {
    // Distinct from undefined: the list IS shared, there is simply nobody to
    // carry over, and the field belongs in the request.
    expect(inheritedListAdminIds([list('SHARED')], 'SHARED')).toEqual([])
  })
})
