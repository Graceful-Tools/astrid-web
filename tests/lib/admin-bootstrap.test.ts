/**
 * RED for task 7610dd07.
 *
 * ensureInitialAdmin() granted AdminUser to whoever held the User row for a
 * hardcoded personal email, and it runs from the daily analytics cron. Passkey
 * registration creates a User for any supplied address with emailVerified
 * deliberately left null and no proof of ownership. So on a fresh or whitelabel
 * deployment — where that row does not exist yet — an attacker could register a
 * passkey for the admin address, wait for the cron, and become an admin.
 *
 * Two independent things were wrong: the address was a source-code constant no
 * partner could change, and the grant never checked that the email was
 * verified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindUnique = vi.hoisted(() => vi.fn())
const adminFindUnique = vi.hoisted(() => vi.fn())
const adminCreate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    adminUser: { findUnique: adminFindUnique, create: adminCreate },
  },
}))

const { ensureInitialAdmin } = await import('@/lib/admin-auth')

const ADMIN_EMAIL = 'owner@example.test'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INITIAL_ADMIN_EMAIL = ADMIN_EMAIL
  adminFindUnique.mockResolvedValue(null)
  adminCreate.mockResolvedValue({})
})

describe('ensureInitialAdmin', () => {
  it('refuses to grant admin to an unverified account', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1', email: ADMIN_EMAIL, emailVerified: null })

    await ensureInitialAdmin()

    expect(adminCreate).not.toHaveBeenCalled()
  })

  it('grants admin once the email is verified', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: ADMIN_EMAIL,
      emailVerified: new Date(),
    })

    await ensureInitialAdmin()

    expect(adminCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', grantedBy: null },
    })
  })

  it('does nothing at all when no bootstrap address is configured', async () => {
    delete process.env.INITIAL_ADMIN_EMAIL

    await ensureInitialAdmin()

    expect(userFindUnique).not.toHaveBeenCalled()
    expect(adminCreate).not.toHaveBeenCalled()
  })

  it('has no hardcoded address to fall back to', async () => {
    delete process.env.INITIAL_ADMIN_EMAIL
    const source = (await import('fs')).readFileSync('lib/admin-auth.ts', 'utf8')

    expect(source).not.toMatch(/@gracefultools\.com|@astrid\.cc/)
  })
})
