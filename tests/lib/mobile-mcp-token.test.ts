/**
 * Task e0613ae5 — the mobile MCP token flow, shared by
 * /api/auth/mobile-mcp-token and its v1 twin.
 *
 * The expiry case is the one that matters: legacy had two inline copies of the
 * session lookup and they had drifted — POST rejected an expired session,
 * DELETE accepted one. These tests pin the single resolver both verbs now use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    mCPToken: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}))

const resolveMCPPlaintext = vi.hoisted(() => vi.fn(() => 'existing-plaintext'))
vi.mock('@/lib/mcp-token', () => ({
  resolveMCPPlaintext,
  mcpTokenStorageFields: vi.fn((t: string) => ({ tokenHash: `hash:${t}` })),
}))

vi.mock('@/lib/mcp-token-utils', () => ({
  generateMCPToken: vi.fn(() => 'fresh-token'),
}))

import {
  resolveMobileSessionUser,
  mintOrReturnMobileToken,
  revokeMobileTokens,
} from '@/lib/mobile-mcp-token'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)
const USER = 'user-1'

function reqWithCookie(name?: string, value = 'session-abc') {
  return {
    cookies: {
      get: (n: string) => (name && n === name ? { value } : undefined),
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.mCPToken.findFirst.mockResolvedValue(null as never)
  mockPrisma.mCPToken.create.mockResolvedValue({ userId: USER } as never)
})

describe('resolveMobileSessionUser (task e0613ae5)', () => {
  it('401s with no session cookie, without querying', async () => {
    const result = await resolveMobileSessionUser(reqWithCookie())

    expect(result).toMatchObject({ ok: false, status: 401, error: 'Unauthorized - No session' })
    expect(mockPrisma.session.findUnique).not.toHaveBeenCalled()
  })

  it('accepts the __Secure- cookie name as well as the plain one', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: new Date(Date.now() + 60_000), user: { id: USER },
    } as never)

    const result = await resolveMobileSessionUser(reqWithCookie('__Secure-next-auth.session-token'))

    expect(result).toMatchObject({ ok: true, userId: USER })
  })

  it('401s on an unknown session token', async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null as never)

    const result = await resolveMobileSessionUser(reqWithCookie('next-auth.session-token'))

    expect(result).toMatchObject({ ok: false, error: 'Unauthorized - Invalid session' })
  })

  it('rejects an EXPIRED session and deletes the row', async () => {
    // The drift this extraction closes: legacy DELETE skipped this check, so an
    // expired cookie could still revoke a user's mobile tokens.
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: new Date(Date.now() - 60_000), user: { id: USER },
    } as never)

    const result = await resolveMobileSessionUser(reqWithCookie('next-auth.session-token'))

    expect(result).toMatchObject({ ok: false, status: 401, error: 'Unauthorized - Session expired' })
    expect(mockPrisma.session.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
  })
})

describe('mintOrReturnMobileToken (task e0613ae5)', () => {
  it('returns the existing live token rather than minting a second one', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({ userId: USER } as never)

    const result = await mintOrReturnMobileToken(USER)

    expect(result).toEqual({ token: 'existing-plaintext', userId: USER })
    expect(mockPrisma.mCPToken.create).not.toHaveBeenCalled()
  })

  it('only reuses a token that is user-level, active and unexpired', async () => {
    await mintOrReturnMobileToken(USER)

    const where = (mockPrisma.mCPToken.findFirst.mock.calls[0][0] as never as {
      where: Record<string, unknown>
    }).where
    expect(where).toMatchObject({
      userId: USER,
      description: 'Mobile App Token',
      isActive: true,
      listId: null,
    })
    expect(where.expiresAt).toBeDefined()
  })

  it('mints a 90-day token when there is none', async () => {
    const before = Date.now()

    const result = await mintOrReturnMobileToken(USER)

    expect(result.token).toBe('fresh-token')
    const data = (mockPrisma.mCPToken.create.mock.calls[0][0] as never as {
      data: { expiresAt: Date; permissions: string[]; listId: null }
    }).data
    const days = (data.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(89.9)
    expect(days).toBeLessThan(90.1)
    expect(data.permissions).toEqual(['read', 'write'])
    expect(data.listId).toBeNull()
  })
})

describe('revokeMobileTokens (task e0613ae5)', () => {
  it('deactivates only this user\'s active mobile tokens', async () => {
    await revokeMobileTokens(USER)

    expect(mockPrisma.mCPToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, description: 'Mobile App Token', isActive: true },
      data: { isActive: false },
    })
  })
})
