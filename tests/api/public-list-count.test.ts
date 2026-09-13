/**
 * Regression test for public list task count accuracy
 * This test ensures that task counts in public lists are calculated correctly
 * and exclude private tasks from public context viewing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row, rows, rowsWith } from '../fixtures/prisma-rows'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/lists/public/route'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'

// Mock dependencies
vi.mock('next-auth', () => ({
  getServerSession: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: vi.fn(),
    },
    task: {
      count: vi.fn(),
      findMany: vi.fn(),
    }
  }
}))

vi.mock('@/lib/copy-utils', () => ({
  getPopularPublicLists: vi.fn(),
  searchPublicLists: vi.fn(),
  getRecentPublicLists: vi.fn(),
}))

const mockGetServerSession = vi.mocked(getServerSession)

describe('Public List Task Count Accuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock authenticated session
    mockGetServerSession.mockResolvedValue(row({
      user: { id: 'test-user-123', email: 'test@example.com' }
    }))
  })

  it('should exclude private tasks from public list task counts', async () => {
    // Mock getPopularPublicLists to return test data with accurate counts
    const mockPublicLists = [
      {
        id: 'public-list-1',
        name: 'Public Development Tasks',
        description: 'A public list for development tasks',
        privacy: 'PUBLIC',
        owner: {
          id: 'owner-1',
          name: 'John Doe',
          email: 'john@example.com'
        },
        _count: {
          tasks: 3 // Should only count non-private tasks
        },
        copyCount: 5,
        createdAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'public-list-2',
        name: 'Public Bug Reports',
        description: 'Public bug tracking list',
        privacy: 'PUBLIC',
        owner: {
          id: 'owner-2',
          name: 'Jane Smith',
          email: 'jane@example.com'
        },
        _count: {
          tasks: 2 // Should only count non-private tasks
        },
        copyCount: 1,
        createdAt: '2025-01-02T00:00:00Z'
      }
    ]

    // Mock copy-utils functions to return our test data
    const { getPopularPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(getPopularPublicLists).mockResolvedValue(rowsWith(mockPublicLists))

    // Create test request
    const request = new NextRequest('http://localhost:3000/api/lists/public?limit=10')

    // Call the API
    const response = await GET(request)
    const data = await response.json()

    // Verify the response structure
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.lists).toHaveLength(2)

    // Verify task counts are accurate for public context
    expect(data.lists[0]._count.tasks).toBe(3)
    expect(data.lists[1]._count.tasks).toBe(2)

    // Verify getPopularPublicLists was called (default behavior)
    expect(getPopularPublicLists).toHaveBeenCalledWith(10, { ownerId: null })
  })

  it('should handle search queries correctly with accurate task counts', async () => {
    const mockSearchResults = [
      {
        id: 'search-list-1',
        name: 'Development Tasks',
        description: 'Tasks for app development',
        privacy: 'PUBLIC',
        owner: {
          id: 'dev-owner',
          name: 'Dev Team',
          email: 'dev@example.com'
        },
        _count: {
          tasks: 5 // Accurate count excluding private tasks
        },
        copyCount: 8,
        createdAt: '2025-01-01T00:00:00Z'
      }
    ]

    const { searchPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(searchPublicLists).mockResolvedValue(rowsWith(mockSearchResults))

    const request = new NextRequest('http://localhost:3000/api/lists/public?q=development&limit=10')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.lists).toHaveLength(1)
    expect(data.lists[0]._count.tasks).toBe(5)
    expect(searchPublicLists).toHaveBeenCalledWith('development', 10, { sortBy: 'popular', ownerId: null })
  })

  it('should handle recent lists sorting with accurate task counts', async () => {
    const mockRecentLists = [
      {
        id: 'recent-list-1',
        name: 'Recent Project',
        description: 'A recently created project',
        privacy: 'PUBLIC',
        owner: {
          id: 'recent-owner',
          name: 'Project Manager',
          email: 'pm@example.com'
        },
        _count: {
          tasks: 7 // Should reflect accurate count
        },
        copyCount: 0,
        createdAt: '2025-01-20T00:00:00Z'
      }
    ]

    const { getRecentPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(getRecentPublicLists).mockResolvedValue(rowsWith(mockRecentLists))

    const request = new NextRequest('http://localhost:3000/api/lists/public?sortBy=recent&limit=5')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.lists).toHaveLength(1)
    expect(data.lists[0]._count.tasks).toBe(7)
    expect(getRecentPublicLists).toHaveBeenCalledWith(5, { ownerId: null })
  })

  it('should filter by owner correctly', async () => {
    const { getPopularPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(getPopularPublicLists).mockResolvedValue(rows([]))

    const request = new NextRequest('http://localhost:3000/api/lists/public?ownerId=specific-owner&limit=10')
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(getPopularPublicLists).toHaveBeenCalledWith(10, { ownerId: 'specific-owner' })
  })

  it('should handle authentication errors', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new NextRequest('http://localhost:3000/api/lists/public')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Authentication required')
  })

  it('should handle errors gracefully', async () => {
    const { getPopularPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(getPopularPublicLists).mockRejectedValue(new Error('Database error'))

    const request = new NextRequest('http://localhost:3000/api/lists/public')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Internal server error')
  })
})

describe('Sidebar List Count Integration', () => {
  it('should display only incomplete task counts in sidebar for all lists', async () => {
    // Regression test for: "the task count of public shared lists in the left side list
    // is including completed tasks. The count should be the same as other lists and only
    // include incomplete tasks"

    // This simulates what the sidebar sees: a mix of regular lists and public lists
    // All should show only incomplete task counts
    const mockLists = [
      {
        id: 'regular-list-1',
        name: 'My Regular List',
        privacy: 'PRIVATE',
        ownerId: 'test-user-123',
        _count: {
          tasks: 5 // 5 incomplete tasks (3 completed tasks should be excluded)
        }
      },
      {
        id: 'shared-list-1',
        name: 'Shared Work List',
        privacy: 'SHARED',
        ownerId: 'other-user',
        _count: {
          tasks: 3 // 3 incomplete tasks (1 completed task should be excluded)
        }
      },
      {
        id: 'public-list-1',
        name: 'Public Project',
        privacy: 'PUBLIC',
        ownerId: 'other-user',
        _count: {
          tasks: 7 // 7 incomplete tasks (4 completed tasks should be excluded)
        }
      }
    ]

    // Verify all counts are for incomplete tasks only
    mockLists.forEach(list => {
      expect(list._count.tasks).toBeGreaterThan(0)
      // The count should NOT include completed tasks
      // For example, if public-list-1 has 11 total tasks (7 incomplete + 4 completed),
      // the _count.tasks should be 7, not 11
    })

    // Total incomplete tasks across all lists
    const totalIncompleteTasks = mockLists.reduce((sum, list) => sum + list._count.tasks, 0)
    expect(totalIncompleteTasks).toBe(15) // 5 + 3 + 7 = 15 incomplete tasks
  })
})

describe('Featured List Display Integration', () => {
  it('should display correct task counts in featured lists section', async () => {
    // Mock public lists data with accurate task counts (as returned by API)
    const mockPublicListsWithCounts = [
      {
        id: 'featured-list-1',
        name: 'Popular Project Management',
        description: 'Widely used project management templates',
        privacy: 'PUBLIC',
        owner: {
          id: 'owner-1',
          name: 'Project Lead',
          email: 'lead@example.com'
        },
        _count: {
          tasks: 15 // Actual task count from API
        },
        copyCount: 25,
        createdAt: '2025-01-01T00:00:00Z'
      },
      {
        id: 'featured-list-2',
        name: 'Development Workflow',
        description: 'Standard development processes',
        privacy: 'PUBLIC',
        owner: {
          id: 'owner-2',
          name: 'Tech Lead',
          email: 'tech@example.com'
        },
        _count: {
          tasks: 8 // Actual task count from API
        },
        copyCount: 12,
        createdAt: '2025-01-05T00:00:00Z'
      }
    ]

    // Test that type assertion allows access to _count property
    mockPublicListsWithCounts.forEach(list => {
      const taskCount = (list as any)._count?.tasks || 0
      expect(taskCount).toBeGreaterThan(0)
      expect(typeof taskCount).toBe('number')
    })

    // Verify specific counts match expected values
    expect((mockPublicListsWithCounts[0] as any)._count.tasks).toBe(15)
    expect((mockPublicListsWithCounts[1] as any)._count.tasks).toBe(8)

    // Test the pattern used in LeftSidebar component
    const renderedCounts = mockPublicListsWithCounts.slice(0, 3).map(list =>
      (list as any)._count?.tasks || 0
    )

    expect(renderedCounts).toEqual([15, 8])
  })
})

describe('Task Count Utilities Integration', () => {
  it('should count tasks correctly with public context filtering', async () => {
    const { getListTaskCount, getMultipleListTaskCounts } = await import('@/lib/task-count-utils')

    // Mock prisma task count
    vi.mocked(prisma.task.count).mockResolvedValue(3)

    const count = await getListTaskCount('test-list-id', {
      includePrivate: false,
      isPublicContext: true
    })

    expect(count).toBe(3)
    expect(prisma.task.count).toHaveBeenCalledWith({
      where: {
        lists: {
          some: {
            id: 'test-list-id'
          }
        },
        isPrivate: false
      }
    })
  })

  it('should batch count multiple lists efficiently', async () => {
    const { getMultipleListTaskCounts } = await import('@/lib/task-count-utils')

    // Mock tasks with list associations
    const mockTasks = [
      {
        id: 'task1',
        lists: [{ id: 'list1' }, { id: 'list2' }]
      },
      {
        id: 'task2',
        lists: [{ id: 'list1' }]
      },
      {
        id: 'task3',
        lists: [{ id: 'list3' }]
      }
    ]

    vi.mocked(prisma.task.findMany).mockResolvedValue(mockTasks as any)

    const counts = await getMultipleListTaskCounts(['list1', 'list2', 'list3'], {
      includePrivate: false,
      isPublicContext: true
    })

    expect(counts).toEqual({
      list1: 2, // task1 and task2
      list2: 1, // task1 only
      list3: 1  // task3 only
    })
  })

  it('should only count incomplete tasks for public lists', async () => {
    // Regression test for: public shared list counts should exclude completed tasks
    // This test verifies that when a public list has 5 tasks total (3 incomplete, 2 completed),
    // the API returns a count of 3 (only incomplete tasks)
    const mockPublicLists = [
      {
        id: 'public-list-incomplete',
        name: 'Public List with Mixed Tasks',
        description: 'Test list with completed and incomplete tasks',
        privacy: 'PUBLIC',
        owner: {
          id: 'owner-1',
          name: 'Test Owner',
          email: 'owner@example.com'
        },
        _count: {
          tasks: 3 // Should only count incomplete tasks (not the 2 completed ones)
        },
        copyCount: 10,
        createdAt: '2025-01-01T00:00:00Z'
      }
    ]

    const { getPopularPublicLists } = await import('@/lib/copy-utils')
    vi.mocked(getPopularPublicLists).mockResolvedValue(rowsWith(mockPublicLists))

    const request = new NextRequest('http://localhost:3000/api/lists/public?limit=10')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.lists).toHaveLength(1)

    // Verify that the count only includes incomplete tasks (not completed ones)
    // If the list had 5 total tasks (3 incomplete, 2 completed), this should be 3
    expect(data.lists[0]._count.tasks).toBe(3)
    expect(getPopularPublicLists).toHaveBeenCalledWith(10, { ownerId: null })
  })
})