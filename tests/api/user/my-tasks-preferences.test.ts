/**
 * Tests for My Tasks Preferences API
 * Ensures cross-device sync works correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { row } from '../../fixtures/prisma-rows'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/v1/users/me/my-tasks-preferences/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'

// Mock dependencies
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

describe('My Tasks Preferences API', () => {
  const mockUserId = 'user-123'
  const mockSession = {
    userId: mockUserId,
    source: 'session' as const,
    scopes: ['*'],
    isAIAgent: false,
    user: { id: mockUserId, email: 'test@example.com', name: null, isAIAgent: false },
  }
  // Every v1 response carries this envelope.
  const meta = { apiVersion: 'v1', authSource: 'session' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(mockSession)
  })

  describe('GET /api/v1/users/me/my-tasks-preferences', () => {
    it('should return default preferences when none are set', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: null,
      }))

      const response = await GET(new NextRequest('http://localhost/api/v1/users/me/my-tasks-preferences'))
      const data = await response.json()

      expect(response.status).toBe(200)
      // Empty filterPriority means "show all" (no filter), NOT [0,1,2,3]
      expect(data).toEqual({
        filterPriority: [],
        filterAssignee: [],
        filterDueDate: 'all',
        filterCompletion: 'default',
        // Legacy defaulted to 'priority'; v1 serves the shared MY_TASKS_DEFAULTS, which match iOS (AWTD-1324).
        sortBy: 'auto',
        manualSortOrder: [],
        meta,
      })
    })

    it('should return saved preferences when they exist', async () => {
      const savedPrefs = {
        filterPriority: [2, 3],
        filterAssignee: ['user-456'],
        filterDueDate: 'today',
        filterCompletion: 'incomplete',
        sortBy: 'when',
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: JSON.stringify(savedPrefs),
      }))

      const response = await GET(new NextRequest('http://localhost/api/v1/users/me/my-tasks-preferences'))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ ...savedPrefs, meta })
    })

    it('should return 401 when not authenticated', async () => {
      // No credential authenticates — including the invalid cookie below
      vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError())

      // Create a proper Request object with headers
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'GET',
        headers: {
          'cookie': 'next-auth.session-token=invalid-token'
        }
      })

      const response = await GET(request as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const response = await GET(new NextRequest('http://localhost/api/v1/users/me/my-tasks-preferences'))
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found')
    })
  })

  describe('PATCH /api/v1/users/me/my-tasks-preferences', () => {
    it('should update preferences and broadcast SSE event', async () => {
      const newPrefs = {
        filterPriority: [3],
        filterDueDate: 'overdue',
      }

      const currentPrefs = {
        filterPriority: [0, 1, 2, 3],
        filterAssignee: [],
        filterDueDate: 'all',
        filterCompletion: 'default',
        sortBy: 'priority',
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: JSON.stringify(currentPrefs),
      }))

      const updatedPrefs = { ...currentPrefs, ...newPrefs }

      vi.mocked(prisma.user.update).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: JSON.stringify(updatedPrefs),
      }))

      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPrefs),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ ...updatedPrefs, meta })
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUserId },
        data: {
          myTasksPreferences: JSON.stringify(updatedPrefs),
        },
        select: {
          myTasksPreferences: true,
        },
      })
    })

    it('should validate filterPriority is an array', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterPriority: 'invalid' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('filterPriority must be an array')
    })

    it('should validate filterAssignee is an array', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterAssignee: 'invalid' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('filterAssignee must be an array')
    })

    it('should validate filterDueDate values', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterDueDate: 'invalid_value' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid filterDueDate value')
    })

    it('should validate filterCompletion values', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterCompletion: 'invalid_value' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid filterCompletion value')
    })

    it('should validate sortBy values', async () => {
      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortBy: 'invalid_value' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid sortBy value')
    })

    it('should merge partial updates with existing preferences', async () => {
      const currentPrefs = {
        filterPriority: [0, 1, 2, 3],
        filterAssignee: ['user-456'],
        filterDueDate: 'all',
        filterCompletion: 'default',
        sortBy: 'priority',
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: JSON.stringify(currentPrefs),
      }))

      const partialUpdate = {
        filterDueDate: 'today',
      }

      const expectedMerged = {
        ...currentPrefs,
        ...partialUpdate,
      }

      vi.mocked(prisma.user.update).mockResolvedValue(row({
        id: mockUserId,
        myTasksPreferences: JSON.stringify(expectedMerged),
      }))

      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialUpdate),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ ...expectedMerged, meta })
    })

    it('should return 401 when not authenticated', async () => {
      vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError())

      const request = new NextRequest('http://localhost:3000/api/v1/users/me/my-tasks-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterDueDate: 'today' }),
      })

      const response = await PATCH(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })
})
