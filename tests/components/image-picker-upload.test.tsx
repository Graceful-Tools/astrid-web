import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagePicker } from '@/components/image-picker'

// Mock fetch for upload tests
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock placeholder utils
vi.mock('@/lib/placeholder-utils', () => ({
  getPlaceholderOptions: vi.fn(() => [
    {
      name: 'lavender',
      color: '#E6E6FA',
      path: '/images/placeholders/lavender.png',
      label: 'Lavender'
    }
  ])
}))

// Mock OpenAI config
vi.mock('@/lib/openai-config', () => ({
  validateOpenAIConfig: vi.fn(() => false)
}))

// Mock default images
vi.mock('@/lib/default-images', () => ({
  DEFAULT_LIST_IMAGES: [
    { filename: 'default-1.svg', name: 'Default 1', category: 'general' }
  ]
}))

const mockProps = {
  currentImageUrl: undefined,
  onSelectImage: vi.fn(),
  onCancel: vi.fn(),
  listName: 'Test List',
  listId: 'test-list-id'
}

describe('ImagePicker Upload Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Custom image upload', () => {
    it('should upload custom image using secure upload', async () => {
      const user = userEvent.setup()

      // Mock successful upload response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fileId: 'test-image-id',
          fileName: 'custom-image.jpg',
          mimeType: 'image/jpeg',
          fileSize: 2048
        })
      })

      render(<ImagePicker {...mockProps} />)

      // Switch to upload tab
      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      // Find and use the file input
      const fileInput = screen.getByLabelText(/upload.*from.*device/i) ||
                       document.querySelector('input[type="file"]')
      expect(fileInput).toBeTruthy()

      const file = new File(['image content'], 'custom-image.jpg', { type: 'image/jpeg' })
      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/v1/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      })

      // Verify the FormData contains correct data
      const uploadCall = mockFetch.mock.calls[0]
      const formData = uploadCall[1].body as FormData
      expect(formData.get('file')).toBe(file)

      const context = JSON.parse(formData.get('context') as string)
      expect(context).toEqual({ listId: 'test-list-id' })

      // Verify onSelectImage was called with secure URL
      await waitFor(() => {
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          '/api/v1/secure-files/test-image-id',
          'custom'
        )
      })
    })

    it('should handle upload without listId by falling back to data URL', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Render without listId
      const propsWithoutListId = { ...mockProps, listId: undefined }
      render(<ImagePicker {...propsWithoutListId} />)

      // Switch to upload tab
      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      // Upload file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'test.jpg', { type: 'image/jpeg' })

      // Mock FileReader
      const mockFileReader = {
        readAsDataURL: vi.fn(),
        onload: null as any,
        result: 'data:image/jpeg;base64,testdata'
      }

      // A regular function, not an arrow: the component does `new FileReader()`, and
      // vitest 4 invokes the mock implementation as a CONSTRUCTOR. An arrow function
      // cannot be constructed, so it throws "is not a constructor". A function
      // expression can, and returning an object makes that object the instance.
      vi.spyOn(window, 'FileReader').mockImplementation(function () {
        return mockFileReader as any
      } as any)

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Simulate FileReader onload
      if (mockFileReader.onload) {
        mockFileReader.onload({ target: { result: 'data:image/jpeg;base64,testdata' } } as any)
      }

      // Should log error about missing listId
      expect(consoleSpy).toHaveBeenCalledWith('No list ID provided for upload')

      // Should still call onSelectImage with data URL
      await waitFor(() => {
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          'data:image/jpeg;base64,testdata',
          'custom'
        )
      })

      consoleSpy.mockRestore()
    })

    it('should handle upload errors by falling back to data URL', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock upload failure
      mockFetch.mockRejectedValueOnce(new Error('Upload failed'))

      render(<ImagePicker {...mockProps} />)

      // Switch to upload tab
      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      // Mock FileReader for fallback
      const mockFileReader = {
        readAsDataURL: vi.fn(),
        onload: null as any,
        result: 'data:image/jpeg;base64,fallbackdata'
      }

      vi.spyOn(window, 'FileReader').mockImplementation(function () {
        return mockFileReader as any
      } as any)

      // Upload file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'error-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload error
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Upload error:', expect.any(Error))
      })

      // Simulate FileReader fallback
      if (mockFileReader.onload) {
        mockFileReader.onload({ target: { result: 'data:image/jpeg;base64,fallbackdata' } } as any)
      }

      // Should fall back to data URL
      await waitFor(() => {
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          'data:image/jpeg;base64,fallbackdata',
          'custom'
        )
      })

      consoleSpy.mockRestore()
    })

    it('should handle server errors during upload', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock server error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' })
      })

      render(<ImagePicker {...mockProps} />)

      // Switch to upload tab
      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      // Mock FileReader for fallback
      const mockFileReader = {
        readAsDataURL: vi.fn(),
        onload: null as any,
        result: 'data:image/jpeg;base64,serverErrorFallback'
      }

      vi.spyOn(window, 'FileReader').mockImplementation(function () {
        return mockFileReader as any
      } as any)

      // Upload file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'server-error-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for error handling
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Upload error:', expect.any(Error))
      })

      // Simulate FileReader fallback
      if (mockFileReader.onload) {
        mockFileReader.onload({ target: { result: 'data:image/jpeg;base64,serverErrorFallback' } } as any)
      }

      // Should fall back to data URL
      await waitFor(() => {
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          'data:image/jpeg;base64,serverErrorFallback',
          'custom'
        )
      })

      consoleSpy.mockRestore()
    })

    it('should handle malformed server response', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock successful HTTP response but missing fileId
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          // Missing fileId
          fileName: 'test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024
        })
      })

      render(<ImagePicker {...mockProps} />)

      // Switch to upload tab
      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      // Mock FileReader for fallback
      const mockFileReader = {
        readAsDataURL: vi.fn(),
        onload: null as any,
        result: 'data:image/jpeg;base64,malformedFallback'
      }

      vi.spyOn(window, 'FileReader').mockImplementation(function () {
        return mockFileReader as any
      } as any)

      // Upload file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'malformed-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for error handling
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Upload failed:', expect.any(Object))
      })

      // Simulate FileReader fallback
      if (mockFileReader.onload) {
        mockFileReader.onload({ target: { result: 'data:image/jpeg;base64,malformedFallback' } } as any)
      }

      // Should fall back to data URL
      await waitFor(() => {
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          'data:image/jpeg;base64,malformedFallback',
          'custom'
        )
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Placeholder and default image selection', () => {
    it('should select placeholder images without upload', async () => {
      const user = userEvent.setup()

      render(<ImagePicker {...mockProps} />)

      // Should be on placeholder tab by default
      const placeholderOption = screen.getByAltText('Lavender')

      if (placeholderOption) {
        await user.click(placeholderOption)
      }

      // Should call onSelectImage with placeholder filename
      expect(mockProps.onSelectImage).toHaveBeenCalledWith('/images/placeholders/lavender.png', 'placeholder')

      // Should not call upload API
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should select default images without upload', async () => {
      const user = userEvent.setup()

      render(<ImagePicker {...mockProps} />)

      // Switch to default icons tab if it exists
      const defaultTab = screen.queryByText('Default Icons')
      if (defaultTab) {
        await user.click(defaultTab)

        const defaultOption = screen.getByText('Default 1') ||
                             screen.getByAltText('Default 1') ||
                             document.querySelector('[data-filename="default-1.svg"]')

        if (defaultOption) {
          await user.click(defaultOption)
        }

        // Should call onSelectImage with default filename
        expect(mockProps.onSelectImage).toHaveBeenCalledWith('default-1.svg', 'placeholder')
      }

      // Should not call upload API
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('File validation', () => {
    it('should accept valid image file types', async () => {
      const user = userEvent.setup()

      // Mock successful upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fileId: 'valid-image-id',
          fileName: 'valid.png',
          mimeType: 'image/png',
          fileSize: 1024
        })
      })

      render(<ImagePicker {...mockProps} />)

      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'valid.png', { type: 'image/png' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
        expect(mockProps.onSelectImage).toHaveBeenCalledWith(
          '/api/v1/secure-files/valid-image-id',
          'custom'
        )
      })
    })
  })

  describe('Integration with list context', () => {
    it('should pass correct listId in upload context', async () => {
      const user = userEvent.setup()

      // Mock successful upload
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fileId: 'context-test-id',
          fileName: 'context-test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024
        })
      })

      const customListId = 'custom-list-123'
      render(<ImagePicker {...mockProps} listId={customListId} />)

      const uploadTab = screen.getByText('Upload')
      await user.click(uploadTab)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['image content'], 'context-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      await waitFor(() => {
        const uploadCall = mockFetch.mock.calls[0]
        const formData = uploadCall[1].body as FormData
        const context = JSON.parse(formData.get('context') as string)
        expect(context).toEqual({ listId: customListId })
      })
    })
  })
})