import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    reminderSettings: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { SETTINGS_UPDATED: 'SETTINGS_UPDATED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET, PUT } from '@/app/api/v1/users/me/settings/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuthenticateAPI = vi.mocked(authenticateAPI)

function makeReq(method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/users/me/settings', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const authedUser = {
  userId: 'user-123',
  source: 'oauth' as const,
  scopes: ['user:read', 'user:write'],
  isAIAgent: false,
  user: { id: 'user-123', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

describe('GET /api/v1/users/me/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateAPI.mockResolvedValue(authedUser as any)
  })

  it('returns persisted reminder settings when present', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'jon@example.com',
      name: 'Jon',
      reminderSettings: {
        enablePushReminders: true,
        enableEmailReminders: false,
        defaultReminderTime: 30,
        enableDailyDigest: true,
        dailyDigestTime: '08:00',
        dailyDigestTimezone: 'America/New_York',
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    } as any)

    const res = await GET(makeReq('GET'), undefined as any)
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.settings.reminderSettings).toMatchObject({
      enablePushReminders: true,
      enableEmailReminders: false,
      defaultReminderTime: 30,
      dailyDigestTime: '08:00',
      dailyDigestTimezone: 'America/New_York',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    })
    expect(json.meta).toMatchObject({ apiVersion: 'v1', authSource: 'oauth' })
  })

  it('falls back to defaults when reminderSettings is null', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'jon@example.com',
      name: 'Jon',
      reminderSettings: null,
    } as any)

    const res = await GET(makeReq('GET'), undefined as any)
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.settings.reminderSettings).toMatchObject({
      enablePushReminders: false,
      enableEmailReminders: true,
      defaultReminderTime: 15,
      enableDailyDigest: false,
      dailyDigestTime: '09:00',
      dailyDigestTimezone: 'America/Los_Angeles',
      quietHoursStart: null,
      quietHoursEnd: null,
    })
  })

  it('returns 404 when user is missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as any)
    const res = await GET(makeReq('GET'), undefined as any)
    expect(res.status).toBe(404)
  })

  it('returns 401 when authentication throws UnauthorizedError', async () => {
    mockAuthenticateAPI.mockRejectedValueOnce(new UnauthorizedError('Bad token'))
    const res = await GET(makeReq('GET'), undefined as any)
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/v1/users/me/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateAPI.mockResolvedValue(authedUser as any)
  })

  it('upserts reminder settings and returns the updated payload', async () => {
    const upsertMock = mockPrisma.reminderSettings.upsert as any
    upsertMock.mockResolvedValue({})
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      email: 'jon@example.com',
      name: 'Jon',
      reminderSettings: {
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60,
        enableDailyDigest: false,
        dailyDigestTime: '09:00',
        dailyDigestTimezone: 'America/Los_Angeles',
        quietHoursStart: null,
        quietHoursEnd: null,
      },
    } as any)

    const res = await PUT(
      makeReq('PUT', {
        reminderSettings: {
          enablePushReminders: true,
          defaultReminderTime: 60,
        },
      }),
      undefined as any
    )

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123' },
        create: expect.objectContaining({
          userId: 'user-123',
          enablePushReminders: true,
          defaultReminderTime: 60,
        }),
        update: expect.objectContaining({
          enablePushReminders: true,
          defaultReminderTime: 60,
        }),
      })
    )

    const json = await res.json()
    expect(json.settings.reminderSettings.defaultReminderTime).toBe(60)
    expect(json.settings.reminderSettings.enablePushReminders).toBe(true)
  })

  it('ignores fields with the wrong type', async () => {
    const upsertMock = mockPrisma.reminderSettings.upsert as any
    upsertMock.mockResolvedValue({})
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      reminderSettings: null,
    } as any)

    await PUT(
      makeReq('PUT', {
        reminderSettings: {
          enablePushReminders: 'yes',           // wrong type — should be skipped
          defaultReminderTime: '30',            // wrong type — should be skipped
          enableEmailReminders: false,          // valid — should be kept
        },
      }),
      undefined as any
    )

    const call = upsertMock.mock.calls[0][0]
    expect(call.update).toEqual({ enableEmailReminders: false })
    expect(call.create.enableEmailReminders).toBe(false)
    expect(call.create.enablePushReminders).toBeUndefined()
    expect(call.create.defaultReminderTime).toBeUndefined()
  })
})
