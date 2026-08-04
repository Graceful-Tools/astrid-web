import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskForm } from '@/components/task-form'
import type { User, TaskList } from '@/types/task'

// Mock fetch for upload tests
const mockFetch = vi.fn()

// Mock components that aren't relevant to upload testing
vi.mock('@/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: any) => (
    <div data-testid="calendar" onClick={() => onSelect(new Date())} />
  )
}))

vi.mock('@/components/when-date-time-picker', () => ({
  WhenDateTimePicker: ({ onChange }: any) => (
    <div data-testid="when-picker" onClick={() => onChange(new Date())} />
  )
}))

vi.mock('@/components/date-time-reminder-picker', () => ({
  DateTimeReminderPicker: () => <div data-testid="reminder-picker" />
}))

vi.mock('@/components/user-picker', () => ({
  UserPicker: ({ onUserSelect }: any) => (
    <div data-testid="user-picker" onClick={() => onUserSelect(null)} />
  )
}))

vi.mock('@/components/attachment-viewer', () => ({
  AttachmentViewer: ({ name }: any) => <div data-testid="attachment-viewer">{name}</div>
}))

// Create test data
const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: null
}

const mockList: TaskList = {
  id: 'list-1',
  name: 'Test List',
  color: '#3b82f6',
  ownerId: 'user-1',
  privacy: 'PRIVATE',
  admins: [],
  members: [],
  listMembers: [],
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockProps = {
  currentUser: mockUser,
  availableLists: [mockList],
  availableUsers: [mockUser],
  onSave: vi.fn(),
  onCancel: vi.fn(),
  currentListId: 'list-1'
}

describe('TaskForm Upload Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    // Use vitest's stubGlobal for fetch
    vi.stubGlobal('fetch', mockFetch)

    // Mock default responses
    mockFetch.mockImplementation((url) => {
      if (url === '/api/user/reminder-settings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      }
      // For other requests, return a default success response
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
  })

  describe('File attachment upload', () => {
    it('should upload file using secure upload with list context for new task', async () => {
      const user = userEvent.setup()

      // Mock the upload endpoint specifically
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'test-attachment-id',
              fileName: 'task-attachment.pdf',
              mimeType: 'application/pdf',
              fileSize: 3072
            })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      render(<TaskForm {...mockProps} />)

      // Find the file input
      const fileInput = document.querySelector('input[type="file"]')
      expect(fileInput).toBeTruthy()

      const file = new File(['pdf content'], 'task-attachment.pdf', { type: 'application/pdf' })
      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      }, { timeout: 3000 })

      // Verify the FormData contains correct data
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1)

      // Find the upload call (should be the one with POST method to secure-upload endpoint)
      const uploadCall = mockFetch.mock.calls.find(call =>
        call[0] === '/api/secure-upload/request-upload' &&
        call[1]?.method === 'POST'
      )

      // Check the call structure - fetch(url, options)
      expect(uploadCall).toBeDefined()
      expect(uploadCall[0]).toBe('/api/secure-upload/request-upload')
      expect(uploadCall[1]).toBeDefined()
      expect(uploadCall[1].method).toBe('POST')

      const formData = uploadCall[1].body as FormData
      expect(formData).toBeInstanceOf(FormData)
      expect(formData.get('file')).toBe(file)

      // For new task, should use currentListId as context
      const context = JSON.parse(formData.get('context') as string)
      expect(context).toEqual({ listId: 'list-1', attachTarget: 'task' })

      // Should show attachment in the form
      await waitFor(() => {
        const attachmentViewer = screen.getByTestId('attachment-viewer')
        expect(attachmentViewer).toHaveTextContent('task-attachment.pdf')
      })
    })

    it('should upload file using task context for existing task', async () => {
      const user = userEvent.setup()

      // Mock the upload endpoint specifically
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'existing-task-attachment-id',
              fileName: 'existing-task.doc',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              fileSize: 4096
            })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      const existingTask = {
        id: 'existing-task-id',
        title: 'Existing Task',
        lists: [mockList]
      }

      render(<TaskForm {...mockProps} task={existingTask} />)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['doc content'], 'existing-task.doc', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      })

      // Find the upload call (should be the one with POST method to secure-upload endpoint)
      const uploadCall = mockFetch.mock.calls.find(call =>
        call[0] === '/api/secure-upload/request-upload' &&
        call[1]?.method === 'POST'
      )

      expect(uploadCall).toBeDefined()
      expect(uploadCall[0]).toBe('/api/secure-upload/request-upload')
      expect(uploadCall[1]).toBeDefined()
      expect(uploadCall[1].method).toBe('POST')

      const formData = uploadCall[1].body as FormData
      expect(formData).toBeInstanceOf(FormData)
      expect(formData.get('file')).toBe(file)

      const context = JSON.parse(formData.get('context') as string)
      // Should use taskId for existing task
      expect(context).toEqual({ taskId: 'existing-task-id', attachTarget: 'task' })
    })

    it('should use selected list context when no current list', async () => {
      const user = userEvent.setup()

      // Mock the upload endpoint specifically
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'selected-list-attachment-id',
              fileName: 'selected-list.txt',
              mimeType: 'text/plain',
              fileSize: 1024
            })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      // Render without currentListId
      const propsWithoutCurrentList = { ...mockProps, currentListId: undefined }
      render(<TaskForm {...propsWithoutCurrentList} />)

      // First select a list by typing in the list input
      const listInput = screen.getByPlaceholderText(/add.*lists?|search.*lists?/i) ||
                       screen.getByRole('textbox')

      await user.type(listInput, 'Test List')

      // Simulate selecting the list (this would normally happen through autocomplete)
      // For testing, we'll simulate the list being selected
      fireEvent.keyDown(listInput, { key: 'Enter' })

      // Now upload a file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['text content'], 'selected-list.txt', { type: 'text/plain' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      })

      // Find the upload call (should be the one with POST method to secure-upload endpoint)
      const uploadCall = mockFetch.mock.calls.find(call =>
        call[0] === '/api/secure-upload/request-upload' &&
        call[1]?.method === 'POST'
      )

      expect(uploadCall).toBeDefined()
      expect(uploadCall[0]).toBe('/api/secure-upload/request-upload')
      expect(uploadCall[1]).toBeDefined()
      expect(uploadCall[1].method).toBe('POST')

      const formData = uploadCall[1].body as FormData
      expect(formData).toBeInstanceOf(FormData)
      expect(formData.get('file')).toBe(file)

      const context = JSON.parse(formData.get('context') as string)
      // Should use the first available list or selected list
      expect(context).toHaveProperty('listId')
    })

    it('should handle upload errors gracefully', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock upload failure
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.reject(new Error('Upload failed'))
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      render(<TaskForm {...mockProps} />)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['test content'], 'error-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error uploading file:', expect.any(Error))
      })

      // File input should be reset
      expect((fileInput as HTMLInputElement).value).toBe('')

      consoleSpy.mockRestore()
    })

    it('should show upload progress during file upload', async () => {
      const user = userEvent.setup()

      // Mock upload with delay to test loading state
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return new Promise(resolve => setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'loading-test-id',
              fileName: 'loading-test.jpg',
              mimeType: 'image/jpeg',
              fileSize: 1024
            })
          }), 100))
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      render(<TaskForm {...mockProps} />)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['test content'], 'loading-test.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        // Start the upload (don't await yet)
        const uploadPromise = user.upload(fileInput as HTMLInputElement, file)

        // Should show some indication of uploading (button disabled, etc.)
        // The file input should be disabled during upload
        await waitFor(() => {
          expect((fileInput as HTMLInputElement).disabled).toBe(true)
        }, { timeout: 200 })

        // Wait for upload to complete
        await uploadPromise
      }
    })

    it('should handle context validation error', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Render without any context (no currentListId, no task, no selected lists)
      const propsWithoutContext = {
        ...mockProps,
        currentListId: undefined,
        availableLists: []
      }

      render(<TaskForm {...propsWithoutContext} />)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['test content'], 'no-context.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Should log error about no context
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error uploading file:',
          expect.objectContaining({
            message: 'No context available for file upload'
          })
        )
      })

      consoleSpy.mockRestore()
    })

    it('should remove attachment from form', async () => {
      const user = userEvent.setup()

      // Mock successful upload
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'removable-attachment-id',
              fileName: 'removable.jpg',
              mimeType: 'image/jpeg',
              fileSize: 1024
            })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      render(<TaskForm {...mockProps} />)

      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['test content'], 'removable.jpg', { type: 'image/jpeg' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for attachment to appear
      await waitFor(() => {
        const attachmentViewer = screen.getByTestId('attachment-viewer')
        expect(attachmentViewer).toHaveTextContent('removable.jpg')
      })

      // Find and click remove button - look for the red remove button (attachment remove button)
      // The remove button should be within the attachment section and have specific styling
      const attachmentSection = screen.getByTestId('attachment-viewer').closest('.flex')
      expect(attachmentSection).toBeTruthy()

      const removeButton = attachmentSection?.querySelector('button.text-red-400') ||
                          attachmentSection?.querySelector('button')

      expect(removeButton).toBeTruthy()
      if (removeButton) {
        await user.click(removeButton as HTMLElement)
      }

      // Attachment should be removed
      await waitFor(() => {
        const attachmentViewer = screen.queryByTestId('attachment-viewer')
        expect(attachmentViewer).not.toBeInTheDocument()
      })

      // ...and actually deleted. Removal used to be local-only: the SecureFile
      // row and its blob outlived every "removal" and the file came back on
      // reload with no explanation (task b4a362f1).
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/secure-files/removable-attachment-id',
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })

    it('puts the attachment back when the delete fails (task b4a362f1)', async () => {
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'doomed-id',
              fileName: 'doomed.pdf',
              mimeType: 'application/pdf',
              fileSize: 1024,
            }),
          })
        }
        if (options?.method === 'DELETE') {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      })

      render(<TaskForm {...mockProps} />)

      const fileInput = document.querySelector('input[type="file"]')
      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, new File(['x'], 'doomed.pdf', { type: 'application/pdf' }))
      }

      await waitFor(() => {
        expect(screen.getByTestId('attachment-viewer')).toHaveTextContent('doomed.pdf')
      })

      const attachmentSection = screen.getByTestId('attachment-viewer').closest('div')?.parentElement
      const removeButton = attachmentSection?.querySelector('button.text-red-400')
      if (removeButton) {
        await user.click(removeButton as HTMLElement)
      }

      // Guard against a vacuous pass: the delete must actually have been attempted.
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/secure-files/doomed-id',
          expect.objectContaining({ method: 'DELETE' })
        )
      })

      // The row comes back rather than silently reappearing on the next reload.
      await waitFor(() => {
        expect(screen.getByTestId('attachment-viewer')).toHaveTextContent('doomed.pdf')
      })

      consoleSpy.mockRestore()
    })
  })

  describe('File validation', () => {
    it('should accept valid file types', async () => {
      const user = userEvent.setup()

      const validFileTypes = [
        { name: 'image.jpg', type: 'image/jpeg' },
        { name: 'image.png', type: 'image/png' },
        { name: 'document.pdf', type: 'application/pdf' },
        { name: 'text.txt', type: 'text/plain' },
        { name: 'word.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      ]

      render(<TaskForm {...mockProps} />)

      const fileInput = document.querySelector('input[type="file"]')

      for (let i = 0; i < validFileTypes.length; i++) {
        const fileType = validFileTypes[i]

        // Mock successful upload for this specific file type
        mockFetch.mockImplementation((url, options) => {
          if (url === '/api/user/reminder-settings') {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({})
            })
          }
          if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({
                fileId: `valid-file-${i}`,
                fileName: fileType.name,
                mimeType: fileType.type,
                fileSize: 1024
              })
            })
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        })

        const file = new File(['content'], fileType.name, { type: fileType.type })

        if (fileInput) {
          await user.upload(fileInput as HTMLInputElement, file)
        }

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
            method: 'POST',
            body: expect.any(FormData)
          })
        })

        // Clear mocks for next iteration
        vi.clearAllMocks()
        mockFetch.mockReset()
      }
    })
  })

  describe('Form submission with attachments', () => {
    it('persists an attachment via the upload, not via the onSave payload (task b4a362f1)', async () => {
      const user = userEvent.setup()

      // Mock successful upload
      mockFetch.mockImplementation((url, options) => {
        if (url === '/api/user/reminder-settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({})
          })
        }
        if (url === '/api/secure-upload/request-upload' && options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              fileId: 'submission-test-id',
              fileName: 'submission-test.pdf',
              mimeType: 'application/pdf',
              fileSize: 2048
            })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      render(<TaskForm {...mockProps} />)

      // Fill in task title
      const titleInput = screen.getByLabelText(/title/i) || screen.getByPlaceholderText(/task.*title/i)
      await user.type(titleInput, 'Test Task with Attachment')

      // Upload file
      const fileInput = document.querySelector('input[type="file"]')
      const file = new File(['pdf content'], 'submission-test.pdf', { type: 'application/pdf' })

      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload to complete
      await waitFor(() => {
        const attachmentViewer = screen.getByTestId('attachment-viewer')
        expect(attachmentViewer).toHaveTextContent('submission-test.pdf')
      })

      // Submit form - look specifically for the submit button
      const submitButton = screen.getByRole('button', { name: /create task/i }) ||
                          screen.getByRole('button', { name: /save task/i }) ||
                          document.querySelector('button[type="submit"]')

      expect(submitButton).toBeTruthy()
      await user.click(submitButton as HTMLElement)

      // The upload itself is what persists the file — it creates a SecureFile
      // row keyed to the task/list. `onSave`'s `attachments` key is the legacy
      // Attachment relation, which POST /api/tasks has never read, so the form
      // passes it through untouched rather than pretending it carries the
      // upload (task b4a362f1).
      await waitFor(() => {
        expect(mockProps.onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Task with Attachment',
            attachments: [],
          })
        )
      })

      // ...and the uploaded file did reach the server, under the right context.
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/secure-upload/request-upload',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})