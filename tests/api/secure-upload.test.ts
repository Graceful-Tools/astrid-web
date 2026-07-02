import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/secure-upload/request-upload/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock Vercel Blob
vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({
    url: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.jpg'
  }),
  del: vi.fn(),
  getDownloadUrl: vi.fn()
}))

// Mock crypto
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue('test-file-id')
  }
})

// Mock secure storage module
vi.mock('@/lib/secure-storage', () => ({
  uploadFileToBlob: vi.fn().mockResolvedValue({
    blobUrl: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.jpg',
    fileId: 'test-file-id'
  }),
  generateSignedDownloadUrl: vi.fn(),
  deleteFile: vi.fn()
}))

// Mock NextRequest with file upload
const createMockRequestWithFile = (context?: any, fileName = 'test.jpg', fileType = 'image/jpeg') => {
  const file = new File(['test content'], fileName, { type: fileType })
  const formData = new FormData()
  formData.append('file', file)
  if (context) {
    formData.append('context', JSON.stringify(context))
  }

  const request = {
    formData: vi.fn().mockResolvedValue(formData),
    url: 'http://localhost:3000/api/secure-upload/request-upload',
    cookies: {
      get: vi.fn().mockReturnValue(undefined)
    }
  } as any as Request
  return request
}

describe('Secure Upload API', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock authenticated session
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })
  })

  describe('POST /api/secure-upload/request-upload', () => {
    it('should upload file with task context', async () => {
      // Mock task permission check
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'test-task-id',
        title: 'Test Task',
        creatorId: 'test-user-id',
        lists: []
      })

      // Mock secure file creation
      mockPrisma.secureFile.create.mockResolvedValue({
        id: 'test-file-id',
        blobUrl: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.jpg',
        originalName: 'test.jpg',
        mimeType: 'image/jpeg',
        fileSize: 12, // matches the 'test content' upload — the route echoes the stored row
        uploadedBy: 'test-user-id',
        taskId: 'test-task-id',
        listId: null,
        commentId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const request = createMockRequestWithFile({ taskId: 'test-task-id' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        fileId: 'test-file-id',
        fileName: 'test.jpg',
        fileSize: 12, // Length of "test content"
        mimeType: 'image/jpeg',
        success: true
      })

      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'test-task-id',
          OR: expect.any(Array)
        }
      })

      expect(mockPrisma.secureFile.create).toHaveBeenCalledWith({
        data: {
          id: 'test-file-id',
          blobUrl: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.jpg',
          originalName: 'test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 12, // Length of "test content"
          uploadedBy: 'test-user-id',
          taskId: 'test-task-id',
          listId: null,
          commentId: null,
          clientRequestId: null, // idempotency key — null when the uploader doesn't send one
        }
      })
    })

    it('should upload file with list context', async () => {
      // Mock list permission check
      mockPrisma.taskList.findFirst.mockResolvedValue({
        id: 'test-list-id',
        name: 'Test List',
        ownerId: 'test-user-id',
        admins: [],
        members: [],
        listMembers: []
      })

      // Mock secure file creation
      mockPrisma.secureFile.create.mockResolvedValue({
        id: 'test-file-id',
        blobUrl: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.jpg',
        originalName: 'test.jpg',
        mimeType: 'image/jpeg',
        fileSize: 12, // matches the 'test content' upload — the route echoes the stored row
        uploadedBy: 'test-user-id',
        taskId: null,
        listId: 'test-list-id',
        commentId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const request = createMockRequestWithFile({ listId: 'test-list-id' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        fileId: 'test-file-id',
        fileName: 'test.jpg',
        fileSize: 12, // Length of "test content"
        mimeType: 'image/jpeg',
        success: true
      })

      expect(mockPrisma.taskList.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'test-list-id',
          OR: expect.any(Array)
        }
      })
    })

    it('should reject unauthorized upload', async () => {
      // Mock no session
      mockGetServerSession.mockResolvedValue(null)

      const request = createMockRequestWithFile({ taskId: 'test-task-id' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toEqual({ error: "Unauthorized" })
    })

    it('should reject upload without context', async () => {
      const request = createMockRequestWithFile() // No context
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: "Missing required fields: file, context" })
    })

    it('should reject upload with invalid context', async () => {
      const request = createMockRequestWithFile({}) // Empty context
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toEqual({ error: "Upload context must specify taskId, listId, commentId, or channelId" })
    })

    it('should reject upload for non-existent task', async () => {
      // Mock task not found
      mockPrisma.task.findFirst.mockResolvedValue(null)

      const request = createMockRequestWithFile({ taskId: 'non-existent-task' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: "Task not found or access denied" })
    })

    it('should reject upload for non-existent list', async () => {
      // Mock list not found
      mockPrisma.taskList.findFirst.mockResolvedValue(null)

      const request = createMockRequestWithFile({ listId: 'non-existent-list' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toEqual({ error: "List not found or access denied" })
    })

    it('should validate file types', async () => {
      // Mock task permission check
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'test-task-id',
        title: 'Test Task',
        creatorId: 'test-user-id',
        lists: []
      })

      const request = createMockRequestWithFile(
        { taskId: 'test-task-id' },
        'script.exe',
        'application/x-executable'
      )

      const response = await POST(request)
      const data = await response.json()

      // Server-side validation now returns 400 for invalid file types
      expect(response.status).toBe(400)
      expect(data.error).toContain('not allowed')
    })

    it('should upload video file', async () => {
      // Mock task permission check
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'test-task-id',
        title: 'Test Task',
        creatorId: 'test-user-id',
        lists: []
      })

      // Mock secure file creation
      mockPrisma.secureFile.create.mockResolvedValue({
        id: 'test-file-id',
        blobUrl: 'https://test-blob-url.vercel-storage.com/files/test-user-id/test-file-id.mp4',
        originalName: 'test.mp4',
        mimeType: 'video/mp4',
        fileSize: 12, // matches the 'test content' upload — the route echoes the stored row
        uploadedBy: 'test-user-id',
        taskId: 'test-task-id',
        listId: null,
        commentId: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      const request = createMockRequestWithFile({ taskId: 'test-task-id' }, 'test.mp4', 'video/mp4')
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        fileId: 'test-file-id',
        fileName: 'test.mp4',
        fileSize: 12, // Length of "test content"
        mimeType: 'video/mp4',
        success: true
      })
    })

    it('should validate file size', async () => {
      // Mock task permission check
      mockPrisma.task.findFirst.mockResolvedValue({
        id: 'test-task-id',
        title: 'Test Task',
        creatorId: 'test-user-id',
        lists: []
      })

      // Create a mock file with fake large size (don't actually allocate 101MB)
      const smallContent = new Blob(['test'], { type: 'image/jpeg' })
      const largeFile = new File([smallContent], 'large.jpg', { type: 'image/jpeg' })
      // Override the size property to simulate a large file
      Object.defineProperty(largeFile, 'size', { value: 101 * 1024 * 1024 })

      const formData = new FormData()
      formData.append('file', largeFile)
      formData.append('context', JSON.stringify({ taskId: 'test-task-id' }))

      const request = {
        formData: vi.fn().mockResolvedValue(formData),
        url: 'http://localhost:3000/api/secure-upload/request-upload',
      } as any as Request

      const response = await POST(request)
      const data = await response.json()

      // Server-side validation now returns 400 for files exceeding size limit
      expect(response.status).toBe(400)
      expect(data.error).toContain('exceeds maximum allowed size')
    })
  })
})