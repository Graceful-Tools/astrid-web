import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileUploadButton, FileAttachmentDisplay } from '@/components/shared/FileUploadButton'

// Mock fetch
global.fetch = vi.fn()

describe('FileUploadButton', () => {
  const mockOnFileUploaded = vi.fn()
  const mockOnError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any).mockClear()
  })

  it('should render upload button', () => {
    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render with custom label', () => {
    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} label="Attach File" />)
    expect(screen.getByText('Attach File')).toBeInTheDocument()
  })

  it('should open file picker on click', () => {
    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} />)

    const button = screen.getByRole('button')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    const clickSpy = vi.spyOn(input, 'click')
    fireEvent.click(button)

    expect(clickSpy).toHaveBeenCalled()
  })

  it('should upload file successfully', async () => {
    const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' })
    const mockResponse = {
      fileId: '123',
      fileName: 'test.txt',
      mimeType: 'text/plain',
      fileSize: 4
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    })

    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} uploadContext={{ taskId: 'task-1' }} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await waitFor(() => {
      fireEvent.change(input, { target: { files: [mockFile] } })
    })

    await waitFor(() => {
      expect(mockOnFileUploaded).toHaveBeenCalledWith({
        url: '/api/v1/secure-files/123',
        name: 'test.txt',
        type: 'text/plain',
        size: 4
      })
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/secure-upload/request-upload',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData)
      })
    )
  })

  it('should show uploading state', async () => {
    const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' })

    ;(global.fetch as any).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: async () => ({ fileId: '123', fileName: 'test.txt', mimeType: 'text/plain', fileSize: 4 })
      }), 100))
    )

    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} label="Attach" />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [mockFile] } })

    // Check uploading state appears
    await waitFor(() => {
      expect(screen.getByText('Uploading...')).toBeInTheDocument()
    })

    // Wait for upload to complete to avoid unhandled rejection after test teardown
    await waitFor(() => {
      expect(mockOnFileUploaded).toHaveBeenCalled()
    }, { timeout: 200 })
  })

  it('should handle upload error', async () => {
    const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' })

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Upload failed' })
    })

    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} onError={mockOnError} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [mockFile] } })

    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error))
    })

    expect(mockOnFileUploaded).not.toHaveBeenCalled()
  })

  it('should validate file size', async () => {
    const largeFile = new File(['x'.repeat(2 * 1024 * 1024)], 'large.txt', { type: 'text/plain' })

    render(
      <FileUploadButton
        onFileUploaded={mockOnFileUploaded}
        onError={mockOnError}
        maxSize={1024 * 1024} // 1MB limit
      />
    )

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [largeFile] } })

    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('exceeds')
        })
      )
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should be disabled when disabled prop is true', () => {
    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} disabled={true} />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should accept file types', () => {
    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} accept="image/*" />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveProperty('accept', 'image/*')
  })

  it('should reset input after successful upload', async () => {
    const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' })

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fileId: '123', fileName: 'test.txt', mimeType: 'text/plain', fileSize: 4 })
    })

    render(<FileUploadButton onFileUploaded={mockOnFileUploaded} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [mockFile] } })

    await waitFor(() => {
      expect(mockOnFileUploaded).toHaveBeenCalled()
    })

    expect(input.value).toBe('')
  })
})

describe('FileAttachmentDisplay', () => {
  const mockFile = {
    url: '/api/v1/secure-files/123',
    name: 'test-file.pdf',
    type: 'application/pdf',
    size: 1536 // 1.5 KB
  }

  it('should display file information', () => {
    render(<FileAttachmentDisplay file={mockFile} />)

    expect(screen.getByText('test-file.pdf')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
  })

  it('should format bytes correctly', () => {
    const smallFile = { ...mockFile, size: 500 }
    const { rerender } = render(<FileAttachmentDisplay file={smallFile} />)
    expect(screen.getByText('500 B')).toBeInTheDocument()

    const mediumFile = { ...mockFile, size: 2048 }
    rerender(<FileAttachmentDisplay file={mediumFile} />)
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()

    const largeFile = { ...mockFile, size: 2 * 1024 * 1024 }
    rerender(<FileAttachmentDisplay file={largeFile} />)
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
  })

  it('should show remove button when onRemove provided', () => {
    const mockOnRemove = vi.fn()
    render(<FileAttachmentDisplay file={mockFile} onRemove={mockOnRemove} />)

    const removeButton = screen.getAllByRole('button')[0]
    expect(removeButton).toBeInTheDocument()

    fireEvent.click(removeButton)
    expect(mockOnRemove).toHaveBeenCalled()
  })

  it('should not show remove button when onRemove not provided', () => {
    render(<FileAttachmentDisplay file={mockFile} />)

    const buttons = screen.queryAllByRole('button')
    expect(buttons.length).toBe(0)
  })
})
