/**
 * Custom board states live on `Project.customStates`, not in TaskList rows.
 *
 * WHY THIS FILE EXISTS. A custom status used to be a `listType: 'status'`
 * TaskList owned by the board owner. That made a *column* into a *list*: it
 * showed up as a row in the lists table, it needed per-user deduplication, and
 * it could not be read by a second member of a shared board without granting
 * them access to a list whose contents span every project the owner has.
 * `Project.customStates` was added for this (AWTD-562) and then never written.
 *
 * These are pure functions over the stored JSON. The storage is a JSON column,
 * so every rule below has to hold against junk: a hand-edited row, a value
 * written by an older build, a half-migrated project.
 *
 * THE INVARIANT THAT MATTERS MOST IS RENAME. A task points at a state by
 * `statusRole`. If renaming a column minted a new role, every task in it would
 * be orphaned — present in the list view, in no column on the board. So rename
 * changes the display name and keeps the role, and that is asserted rather
 * than assumed.
 */

import { describe, it, expect } from 'vitest'
import {
  addCustomState,
  renameCustomState,
  removeCustomState,
  reorderCustomState,
  renameBuiltinState,
} from '@/lib/project-custom-states'

/** Narrowing helper: these functions return a union, and `.states` is on one arm. */
function ok<T extends object>(result: T) {
  expect(result, `expected success, got ${JSON.stringify(result)}`).not.toHaveProperty('error')
  return result as Extract<T, { states: unknown }>
}

describe('addCustomState', () => {
  it('adds the first state to a project that has none', () => {
    const result = ok(addCustomState(null, 'Blocked'))
    expect(result.states).toHaveLength(1)
    expect(result.state.name).toBe('Blocked')
  })

  it('mints a slugged, namespaced role', () => {
    // Namespaced so a custom role can never collide with a future default.
    const result = ok(addCustomState(null, 'In Review'))
    expect(result.state.role).toBe('custom-in-review')
  })

  it('appends after the existing states', () => {
    const first = ok(addCustomState(null, 'Blocked'))
    const second = ok(addCustomState(first.states, 'In Review'))
    expect(second.states.map(s => s.name)).toEqual(['Blocked', 'In Review'])
    expect(second.state.order).toBeGreaterThan(first.state.order)
  })

  it('rejects an empty name', () => {
    expect(addCustomState(null, '   ')).toMatchObject({ error: 'invalid' })
  })

  it('rejects a name over 40 characters', () => {
    expect(addCustomState(null, 'x'.repeat(41))).toMatchObject({ error: 'invalid' })
  })

  it('rejects a duplicate name regardless of case', () => {
    const first = ok(addCustomState(null, 'Blocked'))
    expect(addCustomState(first.states, 'blocked')).toMatchObject({ error: 'duplicate' })
  })

  it('refuses to shadow a default role', () => {
    // Two columns both called Ready is the duplication this change removes.
    expect(addCustomState(null, 'Ready')).toMatchObject({ error: 'reserved' })
    expect(addCustomState(null, 'doing')).toMatchObject({ error: 'reserved' })
  })

  it('uniquifies a role when two different names slug the same', () => {
    // "In Review" and "in-review" are different names but one slug.
    const first = ok(addCustomState(null, 'In Review'))
    const second = ok(addCustomState(first.states, 'In / Review'))
    expect(second.state.role).not.toBe(first.state.role)
    expect(new Set(second.states.map(s => s.role)).size).toBe(2)
  })

  it('avoids a role already taken outside the stored config', () => {
    // A board whose custom columns predate `customStates` holds those roles on
    // legacy list rows. Minting `custom-blocked` again would collide the moment
    // the reader deduplicates by role.
    const result = ok(addCustomState(null, 'Blocked!', { takenRoles: ['custom-blocked'] }))
    expect(result.state.role).toBe('custom-blocked-2')
  })

  it('survives a malformed stored value without throwing', () => {
    // A JSON column can hold anything. Dropping junk beats taking a board down.
    const result = ok(addCustomState({ not: 'an array' }, 'Blocked'))
    expect(result.states).toHaveLength(1)
  })

  it('drops junk entries but keeps the good ones already stored', () => {
    const stored = [{ role: 'custom-blocked', name: 'Blocked', order: 0 }, null, 'nope', { name: 'no role' }]
    const result = ok(addCustomState(stored, 'In Review'))
    expect(result.states.map(s => s.role)).toEqual(['custom-blocked', 'custom-in-review'])
  })
})

describe('renameCustomState', () => {
  it('changes the name and KEEPS the role', () => {
    // The role is what tasks point at. Minting a new one orphans every task
    // in the column — visible in the list view, in no column on the board.
    const first = ok(addCustomState(null, 'Blocked'))
    const renamed = ok(renameCustomState(first.states, first.state.role, 'Waiting on legal'))

    expect(renamed.state.role, 'rename minted a new role and orphaned its tasks').toBe(
      first.state.role,
    )
    expect(renamed.state.name).toBe('Waiting on legal')
  })

  it('rejects a rename onto another state, regardless of case', () => {
    const first = ok(addCustomState(null, 'Blocked'))
    const second = ok(addCustomState(first.states, 'In Review'))
    expect(renameCustomState(second.states, second.state.role, 'blocked')).toMatchObject({
      error: 'duplicate',
    })
  })

  it('allows renaming a state to a different case of its own name', () => {
    const first = ok(addCustomState(null, 'Blocked'))
    const renamed = ok(renameCustomState(first.states, first.state.role, 'BLOCKED'))
    expect(renamed.state.name).toBe('BLOCKED')
  })

  it('refuses to shadow a default role', () => {
    const first = ok(addCustomState(null, 'Blocked'))
    expect(renameCustomState(first.states, first.state.role, 'Ready')).toMatchObject({
      error: 'reserved',
    })
  })

  it('reports an unknown role rather than silently adding one', () => {
    expect(renameCustomState(null, 'custom-nope', 'Whatever')).toMatchObject({
      error: 'not-found',
    })
  })
})

describe('removeCustomState', () => {
  it('drops the state and returns it', () => {
    // The caller needs the removed role: every task still carrying it has to
    // be cleared, or those tasks render in no column at all.
    const first = ok(addCustomState(null, 'Blocked'))
    const second = ok(addCustomState(first.states, 'In Review'))
    const removed = ok(removeCustomState(second.states, first.state.role))

    expect(removed.state.role).toBe(first.state.role)
    expect(removed.states.map(s => s.name)).toEqual(['In Review'])
  })

  it('reports an unknown role', () => {
    expect(removeCustomState(null, 'custom-nope')).toMatchObject({ error: 'not-found' })
  })

  it('refuses to remove a default role', () => {
    // Ready/Doing/Waiting are code constants shared by every board; they are
    // not stored here and cannot be deleted per-project.
    expect(removeCustomState(null, 'ready')).toMatchObject({ error: 'reserved' })
  })
})

describe('reorderCustomState', () => {
  it('moves a custom state up by swapping order values with its predecessor', () => {
    const a = ok(addCustomState(null, 'Blocked'))
    const b = ok(addCustomState(a.states, 'In Review'))
    const result = ok(reorderCustomState(b.states, b.state.role, 'up'))
    const sorted = result.states.slice().sort((x, y) => x.order - y.order)
    expect(sorted[0].name).toBe('In Review')
    expect(sorted[1].name).toBe('Blocked')
  })

  it('moves a custom state down', () => {
    const a = ok(addCustomState(null, 'Blocked'))
    const b = ok(addCustomState(a.states, 'In Review'))
    const result = ok(reorderCustomState(b.states, a.state.role, 'down'))
    const sorted = result.states.slice().sort((x, y) => x.order - y.order)
    expect(sorted[0].name).toBe('In Review')
    expect(sorted[1].name).toBe('Blocked')
  })

  it('is a no-op when the state is already at the top boundary', () => {
    const a = ok(addCustomState(null, 'Blocked'))
    const b = ok(addCustomState(a.states, 'In Review'))
    const result = ok(reorderCustomState(b.states, a.state.role, 'up'))
    const sorted = result.states.slice().sort((x, y) => x.order - y.order)
    expect(sorted[0].name).toBe('Blocked')
  })

  it('is a no-op when the state is already at the bottom boundary', () => {
    const a = ok(addCustomState(null, 'Blocked'))
    const b = ok(addCustomState(a.states, 'In Review'))
    const result = ok(reorderCustomState(b.states, b.state.role, 'down'))
    const sorted = result.states.slice().sort((x, y) => x.order - y.order)
    expect(sorted[1].name).toBe('In Review')
  })

  it('refuses to reorder a built-in role', () => {
    expect(reorderCustomState(null, 'ready', 'up')).toMatchObject({ error: 'reserved' })
  })

  it('reports an unknown role', () => {
    expect(reorderCustomState(null, 'custom-nope', 'up')).toMatchObject({ error: 'not-found' })
  })
})

describe('renameBuiltinState', () => {
  it('stores a name override for a built-in in the customStates array', () => {
    const result = ok(renameBuiltinState(null, 'ready', 'Starting'))
    expect(result.state.role).toBe('ready')
    expect(result.state.name).toBe('Starting')
    expect(result.states.some(s => s.role === 'ready' && s.name === 'Starting')).toBe(true)
  })

  it('preserves the role — tasks still point at "ready" after the rename', () => {
    const result = ok(renameBuiltinState(null, 'ready', 'Starting'))
    expect(result.state.role).toBe('ready')
  })

  it('allows renaming back to the original default name', () => {
    // First rename to something else, then rename back.
    const first = ok(renameBuiltinState(null, 'ready', 'Starting'))
    const back = ok(renameBuiltinState(first.states, 'ready', 'Ready'))
    expect(back.state.name).toBe('Ready')
  })

  it('blocks renaming a built-in to another built-in name', () => {
    expect(renameBuiltinState(null, 'ready', 'Waiting')).toMatchObject({ error: 'reserved' })
  })

  it('blocks renaming to the name of a custom state on the same board', () => {
    const custom = ok(addCustomState(null, 'Blocked'))
    expect(renameBuiltinState(custom.states, 'ready', 'Blocked')).toMatchObject({ error: 'duplicate' })
  })

  it('rejects an empty name', () => {
    expect(renameBuiltinState(null, 'ready', '   ')).toMatchObject({ error: 'invalid' })
  })

  it('rejects a name over 40 characters', () => {
    expect(renameBuiltinState(null, 'ready', 'x'.repeat(41))).toMatchObject({ error: 'invalid' })
  })

  it('reports an error for a non-built-in role', () => {
    expect(renameBuiltinState(null, 'custom-blocked', 'Whatever')).toMatchObject({ error: 'invalid' })
  })
})

