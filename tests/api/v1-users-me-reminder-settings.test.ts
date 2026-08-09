/**
 * GET/PUT /api/v1/users/me/reminder-settings (task 641a7615, decision 3A)
 *
 * The most-used of the five legacy `/api/user/*` endpoints that had no v1
 * successor. Mirrors the legacy shape and validation; the differences are that
 * it takes OAuth as well as a session, and returns the v1 `meta` envelope.
 *
 * The GET is a read that WRITES when nothing exists yet — it seeds defaults.
 * That is legacy behaviour worth keeping (clients rely on always getting a full
 * object back) and worth pinning, because it is surprising.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { reminderSettings: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() } },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET, PUT } from '@/app/api/v1/users/me/reminder-settings/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: 'GET' | 'PUT', body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/reminder-settings', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const existing = { userId: 'u1', enablePushReminders: true, defaultReminderTime: 60 }

describe('GET /api/v1/users/me/reminder-settings (task 641a7615)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', source: 'oauth', scopes: ['*'], clientId: 'c1' } as never)
  })

  it('returns the settings with a v1 meta envelope', async () => {
    mockPrisma.reminderSettings.findUnique.mockResolvedValue(existing as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.enablePushReminders).toBe(true)
    expect(body.meta).toMatchObject({ apiVersion: 'v1' })
  })

  it('seeds defaults when the user has none yet', async () => {
    // Legacy behaviour: the GET creates the row. Clients depend on always
    // receiving a complete object rather than null on first read.
    mockPrisma.reminderSettings.findUnique.mockResolvedValue(null as never)
    mockPrisma.reminderSettings.create.mockResolvedValue({ userId: 'u1', defaultReminderTime: 60 } as never)

    const body = await (await GET(req('GET'))).json()

    expect(mockPrisma.reminderSettings.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
    )
    expect(body.defaultReminderTime).toBe(60)
  })

  it('scopes to the authenticated user', async () => {
    mockPrisma.reminderSettings.findUnique.mockResolvedValue(existing as never)

    await GET(req('GET'))

    expect(mockPrisma.reminderSettings.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})

describe('PUT /api/v1/users/me/reminder-settings (task 641a7615)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
    mockPrisma.reminderSettings.upsert.mockResolvedValue(existing as never)
  })

  it('upserts a partial update', async () => {
    const response = await PUT(req('PUT', { enablePushReminders: false }))

    expect(response.status).toBe(200)
    expect(mockPrisma.reminderSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it('rejects a reminder lead time beyond the 7-day ceiling', async () => {
    // 10080 minutes is the legacy cap. Losing it would let a client schedule a
    // reminder arbitrarily far ahead of the task.
    const response = await PUT(req('PUT', { defaultReminderTime: 10081 }))

    expect(response.status).toBe(400)
    expect(mockPrisma.reminderSettings.upsert).not.toHaveBeenCalled()
  })

  it('rejects a malformed digest time', async () => {
    const response = await PUT(req('PUT', { dailyDigestTime: '25:00' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.reminderSettings.upsert).not.toHaveBeenCalled()
  })

  it('allows quiet hours to be cleared with null', async () => {
    const response = await PUT(req('PUT', { quietHoursStart: null }))

    expect(response.status).toBe(200)
  })

  it('rejects an unknown calendar sync mode', async () => {
    const response = await PUT(req('PUT', { calendarSyncType: 'sometimes' }))

    expect(response.status).toBe(400)
  })
})
