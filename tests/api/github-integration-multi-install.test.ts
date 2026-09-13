/**
 * Regression tests for GitHub Integration multi-installation support
 *
 * Bug: Repositories only showed from the first GitHub installation, not all installations
 * Fix: Updated /api/github/integration to aggregate repositories from all user integrations
 *
 * Bug: "Refresh" button did nothing because /api/github/repositories/refresh didn't exist
 * Fix: Created the refresh endpoint to refresh repositories from all installations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row, rows } from '../fixtures/prisma-rows'
import { GET } from '@/app/api/github/integration/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest
const createMockRequest = (url = 'http://localhost:3000/api/github/integration') => {
  return {
    url,
    headers: {
      get: (name: string) => null
    }
  } as any
}

const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com'
}

// Sample GitHub integrations
const personalIntegration = {
  id: 'integration-1',
  userId: 'test-user-id',
  installationId: 12345678,
  appId: 123456,
  isSharedApp: true,
  repositories: [
    {
      id: 100,
      name: 'personal-repo',
      fullName: 'testuser/personal-repo',
      defaultBranch: 'main',
      private: false,
      owner: 'testuser'
    },
    {
      id: 101,
      name: 'another-personal',
      fullName: 'testuser/another-personal',
      defaultBranch: 'main',
      private: true,
      owner: 'testuser'
    }
  ],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
}

const orgIntegration = {
  id: 'integration-2',
  userId: 'test-user-id',
  installationId: 87654321,
  appId: 123456,
  isSharedApp: true,
  repositories: [
    {
      id: 200,
      name: 'org-repo',
      fullName: 'myorg/org-repo',
      defaultBranch: 'main',
      private: true,
      owner: 'myorg'
    },
    {
      id: 201,
      name: 'org-public',
      fullName: 'myorg/org-public',
      defaultBranch: 'develop',
      private: false,
      owner: 'myorg'
    }
  ],
  createdAt: new Date('2024-02-01'),
  updatedAt: new Date('2024-02-01')
}

describe('GitHub Integration - Multi-Installation Support', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset gitHubIntegration mocks
    Object.values(mockPrisma.gitHubIntegration).forEach((mock: any) => mock.mockReset())

    // Mock authenticated user
    mockGetServerSession.mockResolvedValue(row({ user: mockUser }))
  })

  it('should aggregate repositories from multiple GitHub installations', async () => {
    // User has two GitHub integrations (personal + org)
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([
      personalIntegration,
      orgIntegration
    ]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // Should return aggregated data
    expect(response.status).toBe(200)
    expect(data.integration).toBeDefined()

    // Should have all 4 repositories (2 from personal + 2 from org)
    expect(data.integration.repositories.length).toBe(4)

    // Verify repos from both installations are included
    const repoNames = data.integration.repositories.map((r: any) => r.fullName)
    expect(repoNames).toContain('testuser/personal-repo')
    expect(repoNames).toContain('testuser/another-personal')
    expect(repoNames).toContain('myorg/org-repo')
    expect(repoNames).toContain('myorg/org-public')

    // Each repo should have installationId attached
    const personalRepos = data.integration.repositories.filter(
      (r: any) => r.installationId === 12345678
    )
    const orgRepos = data.integration.repositories.filter(
      (r: any) => r.installationId === 87654321
    )
    expect(personalRepos.length).toBe(2)
    expect(orgRepos.length).toBe(2)
  })

  it('should return multiple installation IDs', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([
      personalIntegration,
      orgIntegration
    ]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // Should have both installation IDs listed
    expect(data.integration.installationIds).toBeDefined()
    expect(data.integration.installationIds.length).toBe(2)
    expect(data.integration.installationIds).toContain(12345678)
    expect(data.integration.installationIds).toContain(87654321)

    // Should report correct integration count
    expect(data.integration.integrationCount).toBe(2)
  })

  it('should maintain backward compatibility with single installation', async () => {
    // User has only one integration
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([personalIntegration]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // Should work like before with single integration
    expect(response.status).toBe(200)
    expect(data.integration.id).toBe('integration-1')
    expect(data.integration.installationId).toBe(12345678)
    expect(data.integration.repositories.length).toBe(2)
    expect(data.integration.connectedAt).toBeDefined()
  })

  it('should return 404 when user has no integrations', async () => {
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.integration).toBeNull()
  })

  it('should handle integration with empty repositories', async () => {
    const emptyIntegration = {
      ...personalIntegration,
      repositories: []
    }

    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([
      emptyIntegration,
      orgIntegration
    ]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // Should only have repos from org integration
    expect(data.integration.repositories.length).toBe(2)
  })

  it('should handle integration with null repositories', async () => {
    const nullReposIntegration = {
      ...personalIntegration,
      repositories: null
    }

    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([
      nullReposIntegration,
      orgIntegration
    ]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // Should handle null gracefully, only show org repos
    expect(data.integration.repositories.length).toBe(2)
  })

  it('should return 401 for unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('should order integrations by createdAt', async () => {
    // Older integration first
    mockPrisma.gitHubIntegration.findMany.mockResolvedValue(rows([
      personalIntegration, // created 2024-01-01
      orgIntegration       // created 2024-02-01
    ]))

    const request = createMockRequest()
    const response = await GET(request)
    const data = await response.json()

    // First integration's data should be used for backward compat fields
    expect(data.integration.id).toBe('integration-1')
    expect(data.integration.installationId).toBe(12345678)
  })
})

describe('GitHub Integration - Repository Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.values(mockPrisma.gitHubIntegration).forEach((mock: any) => mock.mockReset())
    mockGetServerSession.mockResolvedValue(row({ user: mockUser }))
  })

  it('refresh endpoint should be accessible (POST method)', async () => {
    // This test verifies the route file exists and is importable
    // The actual GitHub API calls are mocked in the route
    const { POST } = await import('@/app/api/github/repositories/refresh/route')
    expect(POST).toBeDefined()
    expect(typeof POST).toBe('function')
  })
})
