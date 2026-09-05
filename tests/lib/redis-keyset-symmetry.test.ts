/**
 * RED for task 21dc1119.
 *
 * Keys were tracked under the family prefix alone (`keyset:tasks:user:`) while
 * delPattern looked up `keyset:` + the pattern minus its star
 * (`keyset:tasks:user:<id>`). The two never matched, so sMembers always came
 * back empty and EVERY pattern delete fell through to a full Upstash keyspace
 * scan — on the hottest write path in the app, with a cost that grows with the
 * total number of keys rather than the number being deleted.
 */
import { describe, it, expect, vi } from 'vitest'

// tests/setup.ts mocks '@/lib/redis' globally for every suite; this one is
// about the real naming logic, so it asks for the actual module.
vi.unmock('@/lib/redis')
const { keysetNameForKey, keysetNameForPattern } =
  await vi.importActual<typeof import('@/lib/redis')>('@/lib/redis')

describe('keyset naming is symmetric', () => {
  it.each([
    ['tasks:user:abc', 'tasks:user:abc*'],
    ['tasks:user:abc:page2', 'tasks:user:abc*'],
    ['lists:user:abc', 'lists:user:abc*'],
    ['lists:user:abc:v1', 'lists:user:abc*'],
    ['members:list:xyz', 'members:list:xyz*'],
    ['comments:task:t1', 'comments:task:t1*'],
    ['tasks:list:l1', 'tasks:list:l1*'],
  ])('key %s is tracked where delPattern(%s) looks', (key, pattern) => {
    expect(keysetNameForKey(key)).toBe(keysetNameForPattern(pattern))
  })

  it('scopes the set per entity, so one user does not evict another', () => {
    expect(keysetNameForKey('tasks:user:alice')).not.toBe(keysetNameForKey('tasks:user:bob'))
  })

  it('returns null for a key family with no pattern deletes', () => {
    expect(keysetNameForKey('user:abc')).toBeNull()
    expect(keysetNameForKey('users:search:foo')).toBeNull()
  })
})

describe('invalidate.userLists blast radius', () => {
  it('no longer wipes every list member cache on the platform', async () => {
    const source = (await import('fs')).readFileSync('lib/redis.ts', 'utf8')

    // `members:list:*` DOES resolve to a tracked keyset, so a single membership
    // change deleted the cached member set for every list on the platform.
    expect(source).not.toContain('delPattern(`members:list:*`)')
  })
})
