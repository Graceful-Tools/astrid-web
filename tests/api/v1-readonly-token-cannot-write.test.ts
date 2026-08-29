/**
 * A readonly-preset OAuth token must not be able to write (task 36d0f047).
 *
 * The `readonly` scope preset (lib/oauth/oauth-scopes.ts) includes `user:read`
 * and is documented as "Read-only access for monitoring and analytics tools".
 * Two v1 write endpoints were gated by that READ scope, so a readonly token
 * could clear the caller's entire unread inbox (`PUT /api/v1/notifications`
 * with `{ all: true }`) and file feature requests as the user
 * (`POST /api/v1/feature-requests`).
 *
 * These tests run the REAL requireScopes/hasRequiredScopes logic — only
 * authenticateAPI is mocked, to control which scopes the caller holds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    featureAccessRequest: { findUnique: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware'
  )
  return { ...actual, authenticateAPI: vi.fn() }
})

vi.mock('@/lib/email', () => ({ sendFeatureAccessRequestEmail: vi.fn() }))

import { PUT as notificationsPUT } from '@/app/api/v1/notifications/route'
import { POST as featureRequestsPOST } from '@/app/api/v1/feature-requests/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authWith = (scopes: string[]) =>
  mockAuth.mockResolvedValue({
    userId: 'u1',
    source: 'oauth',
    scopes,
    clientId: 'client-1',
    isAIAgent: false,
    user: { id: 'u1', email: 'u1@example.com', name: 'U One', isAIAgent: false },
  } as never)

const putNotifications = () =>
  notificationsPUT(
    new NextRequest('http://localhost/api/v1/notifications', {
      method: 'PUT',
      body: JSON.stringify({ all: true }),
      headers: { 'Content-Type': 'application/json' },
    }),
    undefined as never
  )

const postFeatureRequest = () =>
  featureRequestsPOST(
    new NextRequest('http://localhost/api/v1/feature-requests', {
      method: 'POST',
      body: JSON.stringify({ featureKey: 'project_mode' }),
      headers: { 'Content-Type': 'application/json' },
    }),
    undefined as never
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readonly token cannot mutate (task 36d0f047)', () => {
  it('PUT /api/v1/notifications is 403 for the readonly scope preset', async () => {
    authWith([...SCOPE_GROUPS.readonly])

    const response = await putNotifications()

    expect(response.status).toBe(403)
    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled()
  })

  it('POST /api/v1/feature-requests is 403 for the readonly scope preset', async () => {
    authWith([...SCOPE_GROUPS.readonly])

    const response = await postFeatureRequest()

    expect(response.status).toBe(403)
    expect(mockPrisma.featureAccessRequest.upsert).not.toHaveBeenCalled()
  })
})

describe('user:write still writes (task 36d0f047)', () => {
  it('PUT /api/v1/notifications succeeds with user:write', async () => {
    authWith(['user:write'])
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 } as never)

    const response = await putNotifications()

    expect(response.status).toBe(200)
    expect(mockPrisma.notification.updateMany).toHaveBeenCalled()
  })

  it('POST /api/v1/feature-requests succeeds with user:write', async () => {
    authWith(['user:write'])
    mockPrisma.featureAccessRequest.findUnique.mockResolvedValue(null)
    mockPrisma.featureAccessRequest.upsert.mockResolvedValue({
      status: 'PENDING',
      useCase: null,
      createdAt: new Date(),
      grandfathered: false,
    } as never)
    mockPrisma.user.findUnique.mockResolvedValue({
      email: 'u1@example.com',
      name: 'U One',
    } as never)

    const response = await postFeatureRequest()

    // 201: no existing row for this (user, feature) pair, so the upsert creates
    expect(response.status).toBe(201)
    expect(mockPrisma.featureAccessRequest.upsert).toHaveBeenCalled()
  })
})
