import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DELETE } from '@/app/api/comments/[id]/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest for DELETE requests
const createMockDeleteRequest = () => {
  const request = {
    url: 'http://localhost:3000/api/comments/test-comment-id',
  } as any as Request
  return request
}

// Mock sse-utils to prevent actual SSE calls during tests
vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

// Mock auth config
vi.mock('@/lib/auth-config', () => ({
  authConfig: {},
}))

describe('Comment Deletion API', () => {
  const mockComment = {
    id: 'test-comment-id',
    content: 'Test comment content',
    type: 'TEXT',
    authorId: 'test-user-id',
    taskId: 'test-task-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    parentCommentId: null,
    author: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
    },
    task: {
      id: 'test-task-id',
      title: 'Test Task',
      creatorId: 'test-user-id',
      assigneeId: null,
      lists: [{
        id: 'test-list-id',
        name: 'Test List',
        ownerId: 'test-user-id',
        owner: { id: 'test-user-id' },
        listMembers: []
      }]
    }
  }

  const mockReply = {
    id: 'test-reply-id',
    content: 'Test reply content',
    type: 'TEXT',
    authorId: 'test-user-id',
    taskId: 'test-task-id',
    parentCommentId: 'test-comment-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    author: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
    },
    task: {
      id: 'test-task-id',
      title: 'Test Task',
      creatorId: 'test-user-id',
      assigneeId: null,
      lists: [{
        id: 'test-list-id',
        name: 'Test List',
        ownerId: 'test-user-id',
        owner: { id: 'test-user-id' },
        listMembers: []
      }]
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    // Mock authenticated session by default
    const { getServerSession } = await import('next-auth')
    const mockGetServerSession = vi.mocked(getServerSession)
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        image: 'test-image-url',
      }
    } as any)

    // Mock user exists in database
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null
    })
  })

  describe('DELETE /api/comments/[id]', () => {
    it('should successfully delete comment when user is the author', async () => {
      // Setup
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment)
      mockPrisma.comment.delete.mockResolvedValue(mockComment)

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(mockPrisma.comment.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-comment-id' },
        include: {
          author: true,
          task: {
            include: {
              lists: {
                include: {
                  owner: true,
                  listMembers: true,
                },
              },
            },
          },
        },
      })
      expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
        where: { id: 'test-comment-id' }
      })
    })

    it('should successfully delete reply when user is the author', async () => {
      // Setup
      mockPrisma.comment.findUnique.mockResolvedValue(mockReply)
      mockPrisma.comment.delete.mockResolvedValue(mockReply)

      const request = createMockDeleteRequest()
      const params = { id: 'test-reply-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
      expect(mockPrisma.comment.delete).toHaveBeenCalledWith({
        where: { id: 'test-reply-id' }
      })
    })

    it('should allow list owner to delete any comment on their list', async () => {
      // Setup - different user's comment but on list owned by authenticated user
      const otherUserComment = {
        ...mockComment,
        authorId: 'other-user-id',
        author: {
          id: 'other-user-id',
          name: 'Other User',
          email: 'other@example.com',
          image: 'other-image-url',
        }
      }

      mockPrisma.comment.findUnique.mockResolvedValue(otherUserComment)
      mockPrisma.comment.delete.mockResolvedValue(otherUserComment)

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
    })

    it('should allow list admin to delete any comment on their list', async () => {
      // Setup - different user's comment but authenticated user is list admin
      const otherUserComment = {
        ...mockComment,
        authorId: 'other-user-id',
        author: {
          id: 'other-user-id',
          name: 'Other User',
          email: 'other@example.com',
          image: 'other-image-url',
        },
        task: {
          ...mockComment.task,
          lists: [{
            ...mockComment.task.lists[0],
            ownerId: 'different-owner-id',
            listMembers: [{ userId: 'test-user-id', role: 'admin', user: { id: 'test-user-id' } }], // Current user is admin
          }]
        }
      }

      mockPrisma.comment.findUnique.mockResolvedValue(otherUserComment)
      mockPrisma.comment.delete.mockResolvedValue(otherUserComment)

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(200)
      expect(result.success).toBe(true)
    })

    it('should return 401 when user is not authenticated', async () => {
      // Setup - mock getServerSession to return null (no session)
      const { getServerSession } = await import('next-auth')
      const mockGetServerSession = vi.mocked(getServerSession)
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(401)
      expect(result.error).toBe('Unauthorized')
    })

    it('should return 404 when comment does not exist', async () => {
      // Setup
      mockPrisma.comment.findUnique.mockResolvedValue(null)

      const request = createMockDeleteRequest()
      const params = { id: 'non-existent-comment' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(404)
      expect(result.error).toBe('Comment not found')
    })

    it('should return 403 when user cannot delete comment', async () => {
      // Setup - different user's comment on list where current user has no permissions
      const unauthorizedComment = {
        ...mockComment,
        authorId: 'other-user-id',
        author: {
          id: 'other-user-id',
          name: 'Other User',
          email: 'other@example.com',
          image: 'other-image-url',
        },
        task: {
          ...mockComment.task,
          creatorId: 'other-user-id',
          assigneeId: 'other-user-id',
          lists: [{
            ...mockComment.task.lists[0],
            ownerId: 'other-user-id',
            // Must override the owner relation too — the spread above carries
            // the base fixture's owner (test-user-id). Leaving it made the
            // fixture self-contradictory: ownerId said one user, the relation
            // said another, and the permission helper honours both.
            owner: { id: 'other-user-id' },
            admins: [], // Current user is not admin
            members: [], // Current user is not member
            listMembers: [] // Current user is not list member
          }]
        }
      }

      mockPrisma.comment.findUnique.mockResolvedValue(unauthorizedComment)

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(403)
      expect(result.error).toBe('You can only delete your own comments or comments on tasks you manage')
    })

    it('should handle database errors gracefully', async () => {
      // Setup
      mockPrisma.comment.findUnique.mockRejectedValue(new Error('Database error'))

      const request = createMockDeleteRequest()
      const params = { id: 'test-comment-id' }

      // Execute
      const response = await DELETE(request, { params })
      const result = await response.json()

      // Verify
      expect(response.status).toBe(500)
      expect(result.error).toBe('Internal server error')
    })
  })
})