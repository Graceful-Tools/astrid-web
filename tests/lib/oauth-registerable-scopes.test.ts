import { describe, it, expect } from 'vitest'
import {
  validateRegisterableScopes,
  isRegisterableScope,
  validateScopes,
} from '@/lib/oauth/oauth-scopes'

/**
 * Locks the fix for OAuth scope escalation: a client-registration body could
 * pass `scopes: ['*']`, which `validateScopes` accepted, minting a
 * full-access client in one request. Registerable scopes must never include
 * the wildcard.
 */
describe('validateRegisterableScopes', () => {
  it('strips the wildcard from client-supplied scopes', () => {
    expect(validateRegisterableScopes(['tasks:read', '*', 'lists:read']))
      .toEqual(['tasks:read', 'lists:read'])
    expect(validateRegisterableScopes(['*'])).toEqual([])
  })

  it('still drops unknown scopes', () => {
    expect(validateRegisterableScopes(['tasks:read', 'not:a:scope'])).toEqual(['tasks:read'])
  })

  it('isRegisterableScope rejects the wildcard but accepts real scopes', () => {
    expect(isRegisterableScope('*')).toBe(false)
    expect(isRegisterableScope('tasks:read')).toBe(true)
  })

  it('documents that the plain validateScopes still lets the wildcard through (session/internal use)', () => {
    // Guards against someone "simplifying" the two functions back into one.
    expect(validateScopes(['*'])).toEqual(['*'])
  })
})
