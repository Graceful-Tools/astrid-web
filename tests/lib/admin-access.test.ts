import { describe, expect, it } from 'vitest'
import { resolveAdminAccess } from '@/lib/admin-access'

describe('resolveAdminAccess', () => {
  it('redirects unauthenticated users to sign in', () => {
    expect(resolveAdminAccess(null, false)).toEqual({ redirectTo: '/auth/signin' })
  })

  it('redirects authenticated non-admins away from admin pages', () => {
    expect(resolveAdminAccess({ user: { id: 'user-1' } }, false)).toEqual({ redirectTo: '/' })
  })

  it('allows users represented by an AdminUser row', () => {
    expect(resolveAdminAccess({ user: { id: 'admin-1' } }, true)).toEqual({ allowed: true })
  })
})
