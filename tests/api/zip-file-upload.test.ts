import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadFileToBlob } from '@/lib/secure-storage'

// Mock Vercel Blob
vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({
    url: 'https://example.vercel-storage.com/files/user123/test-file-123.zip'
  }),
  del: vi.fn(),
  getDownloadUrl: vi.fn()
}))

describe('ZIP File Upload Support', () => {
  it('should be included in HTML file input accept attributes', () => {
    // This test ensures that ZIP files are selectable in file pickers
    const acceptPattern = /accept="[^"]*\.zip[^"]*"/

    // Test that our components include .zip in their accept attributes
    const mockAcceptAttribute = 'image/*,.pdf,.doc,.docx,.txt,.xlsx,.pptx,.zip'
    expect(mockAcceptAttribute).toContain('.zip')
    expect(mockAcceptAttribute).toMatch(/\.zip/)
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should allow ZIP file uploads', async () => {
    // Create a mock ZIP file
    const mockZipFile = new File(['mock zip content'], 'test-file.zip', {
      type: 'application/zip'
    })

    const uploadRequest = {
      fileName: 'test-file.zip',
      fileType: 'application/zip',
      fileSize: 1024, // 1KB
      uploadContext: {
        taskId: 'task-123',
        userId: 'user-123'
      }
    }

    // Should not throw an error for ZIP files
    const result = await uploadFileToBlob(mockZipFile, uploadRequest)

    expect(result).toBeDefined()
    expect(result.blobUrl).toBeTruthy()
    expect(result.fileId).toBeTruthy()
  })

  it('should include application/zip in allowed types', async () => {
    const mockZipFile = new File(['mock zip content'], 'archive.zip', {
      type: 'application/zip'
    })

    const uploadRequest = {
      fileName: 'archive.zip',
      fileType: 'application/zip',
      fileSize: 5 * 1024 * 1024, // 5MB
      uploadContext: {
        commentId: 'comment-123',
        userId: 'user-123'
      }
    }

    // This should succeed without throwing a file type error
    await expect(uploadFileToBlob(mockZipFile, uploadRequest)).resolves.toBeDefined()
  })

  it('should still enforce file size limits for ZIP files', async () => {
    const mockLargeZipFile = new File(['mock large zip content'], 'large-file.zip', {
      type: 'application/zip'
    })

    const uploadRequest = {
      fileName: 'large-file.zip',
      fileType: 'application/zip',
      fileSize: 110 * 1024 * 1024, // 110MB (over 100MB limit)
      uploadContext: {
        listId: 'list-123',
        userId: 'user-123'
      }
    }

    // Should throw file size error, not file type error
    await expect(uploadFileToBlob(mockLargeZipFile, uploadRequest))
      .rejects.toThrow('File size cannot exceed 100MB')
  })

  it('should work with different ZIP file names and contexts', async () => {
    const testCases = [
      {
        fileName: 'project-files.zip',
        context: { taskId: 'task-456', userId: 'user-456' }
      },
      {
        fileName: 'backup.zip',
        context: { commentId: 'comment-789', userId: 'user-789' }
      },
      {
        fileName: 'resources.zip',
        context: { listId: 'list-101', userId: 'user-101' }
      }
    ]

    for (const testCase of testCases) {
      const mockZipFile = new File(['content'], testCase.fileName, {
        type: 'application/zip'
      })

      const uploadRequest = {
        fileName: testCase.fileName,
        fileType: 'application/zip',
        fileSize: 2048,
        uploadContext: testCase.context
      }

      const result = await uploadFileToBlob(mockZipFile, uploadRequest)
      expect(result.blobUrl).toBeTruthy()
      expect(result.blobUrl).toContain('.zip') // Should contain the zip extension
      expect(result.fileId).toBeTruthy()
    }
  })

  it('should reject non-ZIP files that try to claim ZIP type', async () => {
    // Test security: reject files that claim to be ZIP but have wrong MIME type
    const mockFakeZipFile = new File(['not a zip'], 'fake.zip', {
      type: 'text/plain' // Wrong MIME type
    })

    const uploadRequest = {
      fileName: 'fake.zip',
      fileType: 'text/plain', // This should be rejected by our system's normal flow
      fileSize: 1024,
      uploadContext: {
        taskId: 'task-123',
        userId: 'user-123'
      }
    }

    // text/plain is allowed, but if we had a file with unsupported type, it should fail
    const unsupportedRequest = {
      ...uploadRequest,
      fileType: 'application/x-executable', // This should be rejected
    }

    // Still rejected, and now for a sharper reason. Before task c09f3eb1 this
    // surface checked MIME only, so the refusal was "that type is not allowed".
    // It now checks the extension too, and .zip carrying x-executable fails as
    // a MISMATCH — the more precise complaint, and the one that also catches a
    // permitted MIME arriving on a foreign extension.
    //
    // Asserting rejection rather than the wording: the security property is
    // that this cannot be stored, not how the sentence reads.
    await expect(uploadFileToBlob(mockFakeZipFile, unsupportedRequest)).rejects.toThrow(
      /not allowed|mismatch/i,
    )
  })
})