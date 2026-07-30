import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock navigator.onLine
let mockOnline = true
vi.stubGlobal('navigator', {
  get onLine() { return mockOnline }
})

// Mock URL.createObjectURL / revokeObjectURL — the two static helpers ONLY.
//
// This used to `vi.stubGlobal('URL', { ... })`, which replaced the entire global with a
// plain object and so destroyed the URL *constructor*. That was always wrong; it merely
// went unnoticed until vitest 4, where any `new URL(...)` in the code under test fails
// with "URL is not a constructor". Stubbing the methods keeps the constructor intact.
vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-url-${Math.random()}`)
vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

// Mock OfflineAttachmentOperations
const mockAttachments = new Map<string, any>()
vi.mock('@/lib/offline-db', () => ({
  offlineDB: {
    getStorageInfo: vi.fn().mockResolvedValue({ attachments: 0 })
  },
  OfflineAttachmentOperations: {
    getAttachment: vi.fn((id) => Promise.resolve(mockAttachments.get(id))),
    saveAttachmentWithBlob: vi.fn((attachment, blob) => {
      mockAttachments.set(attachment.id, { ...attachment, blob })
      return Promise.resolve()
    }),
    deleteAttachment: vi.fn((id) => {
      mockAttachments.delete(id)
      return Promise.resolve()
    }),
    getCacheSize: vi.fn().mockResolvedValue(0),
    clearAttachments: vi.fn(() => {
      mockAttachments.clear()
      return Promise.resolve()
    })
  }
}))

// Mock CrossTabSync
vi.mock('@/lib/cross-tab-sync', () => ({
  CrossTabSync: {
    broadcastCacheUpdated: vi.fn(),
    broadcastEntityDeleted: vi.fn()
  }
}))

describe('AttachmentCache', () => {
  let AttachmentCache: any
  let OfflineAttachmentOperations: any

  beforeEach(async () => {
    vi.resetModules()
    mockOnline = true
    mockFetch.mockReset()
    mockAttachments.clear()

    const attachmentModule = await import('@/lib/attachment-cache')
    AttachmentCache = attachmentModule.AttachmentCache

    const offlineDbModule = await import('@/lib/offline-db')
    OfflineAttachmentOperations = offlineDbModule.OfflineAttachmentOperations
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getAttachment', () => {
    it('should return cached attachment from IndexedDB', async () => {
      const mockBlob = new Blob(['test'], { type: 'text/plain' })
      mockAttachments.set('att-1', {
        id: 'att-1',
        name: 'test.txt',
        blob: mockBlob
      })

      const result = await AttachmentCache.getAttachment('att-1', 'https://example.com/file.txt')

      expect(result.isCached).toBe(true)
      expect(result.blob).toBe(mockBlob)
      expect(result.url).toContain('blob:')
    })

    it('should download and cache attachment when not cached', async () => {
      const mockBlob = new Blob(['downloaded content'], { type: 'text/plain' })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      })

      const result = await AttachmentCache.getAttachment('att-2', 'https://example.com/file.txt', {
        name: 'file.txt',
        mimeType: 'text/plain',
        size: 100
      })

      expect(result.isCached).toBe(true)
      expect(result.blob).toBe(mockBlob)
      expect(OfflineAttachmentOperations.saveAttachmentWithBlob).toHaveBeenCalled()
    })

    it('should return original URL when offline and not cached', async () => {
      mockOnline = false

      const result = await AttachmentCache.getAttachment('att-3', 'https://example.com/file.txt')

      expect(result.isCached).toBe(false)
      expect(result.blob).toBeNull()
      expect(result.url).toBe('https://example.com/file.txt')
      expect(result.error).toContain('Offline')
    })

    it('should not download when autoDownload is false', async () => {
      const result = await AttachmentCache.getAttachment('att-4', 'https://example.com/file.txt', {
        download: false
      })

      expect(result.isCached).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should handle download errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await AttachmentCache.getAttachment('att-5', 'https://example.com/file.txt')

      expect(result.isCached).toBe(false)
      expect(result.blob).toBeNull()
    })

    it('should not duplicate concurrent downloads', async () => {
      const mockBlob = new Blob(['content'], { type: 'text/plain' })
      let downloadCount = 0

      mockFetch.mockImplementation(() => {
        downloadCount++
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(mockBlob)
        })
      })

      // Start two concurrent downloads for same attachment
      const [result1, result2] = await Promise.all([
        AttachmentCache.getAttachment('att-6', 'https://example.com/file.txt'),
        AttachmentCache.getAttachment('att-6', 'https://example.com/file.txt')
      ])

      // Should only download once
      expect(downloadCount).toBe(1)
      expect(result1.blob).toBe(result2.blob)
    })
  })

  describe('isCached', () => {
    it('should return true when attachment has blob', async () => {
      const mockBlob = new Blob(['test'], { type: 'text/plain' })
      mockAttachments.set('att-cached', { id: 'att-cached', blob: mockBlob })

      const result = await AttachmentCache.isCached('att-cached')

      expect(result).toBe(true)
    })

    it('should return false when attachment not cached', async () => {
      const result = await AttachmentCache.isCached('att-not-cached')

      expect(result).toBe(false)
    })
  })

  describe('getCachedBlobUrl', () => {
    it('should return blob URL for cached attachment', async () => {
      const mockBlob = new Blob(['test'], { type: 'text/plain' })
      mockAttachments.set('att-url', { id: 'att-url', blob: mockBlob })

      const url = await AttachmentCache.getCachedBlobUrl('att-url')

      expect(url).toContain('blob:')
    })

    it('should return null for non-cached attachment', async () => {
      const url = await AttachmentCache.getCachedBlobUrl('att-none')

      expect(url).toBeNull()
    })
  })

  describe('removeFromCache', () => {
    it('should delete attachment from cache', async () => {
      mockAttachments.set('att-delete', { id: 'att-delete', blob: new Blob() })

      await AttachmentCache.removeFromCache('att-delete')

      expect(OfflineAttachmentOperations.deleteAttachment).toHaveBeenCalledWith('att-delete')
    })
  })

  describe('clearCache', () => {
    it('should clear all attachments', async () => {
      await AttachmentCache.clearCache()

      expect(OfflineAttachmentOperations.clearAttachments).toHaveBeenCalled()
    })
  })

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const stats = await AttachmentCache.getCacheStats()

      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('downloads')
      expect(stats).toHaveProperty('errors')
      expect(stats).toHaveProperty('cachedCount')
      expect(stats).toHaveProperty('cacheSize')
    })
  })

  describe('isDownloading', () => {
    it('should track downloading state', async () => {
      // Not downloading initially
      expect(AttachmentCache.isDownloading('att-check')).toBe(false)
    })
  })

  describe('prefetchForTask', () => {
    it('should prefetch attachments in background', async () => {
      const mockBlob = new Blob(['content'], { type: 'text/plain' })
      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob)
      })

      const attachments = [
        { id: 'prefetch-1', url: 'https://example.com/1.txt' },
        { id: 'prefetch-2', url: 'https://example.com/2.txt' }
      ]

      // Start prefetch (non-blocking)
      await AttachmentCache.prefetchForTask('task-1', attachments)

      // Give time for background fetches
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should have attempted to download both
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should skip already cached attachments', async () => {
      const mockBlob = new Blob(['cached'], { type: 'text/plain' })
      mockAttachments.set('prefetch-cached', { id: 'prefetch-cached', blob: mockBlob })

      const attachments = [
        { id: 'prefetch-cached', url: 'https://example.com/cached.txt' }
      ]

      await AttachmentCache.prefetchForTask('task-2', attachments)

      // Should not download already cached
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should not prefetch when offline', async () => {
      mockOnline = false

      const attachments = [
        { id: 'offline-1', url: 'https://example.com/1.txt' }
      ]

      await AttachmentCache.prefetchForTask('task-3', attachments)

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
