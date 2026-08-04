/**
 * Multi-file selection on the shared comment/chat input (Task 9f325964).
 *
 * The unit tests in tests/lib/comment-attachments.test.ts cover the queue
 * arithmetic; these cover the wiring that actually broke — the file input had
 * no `multiple` and its handler read only files[0].
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { RichTextInput } from '@/components/shared/RichTextInput'

global.fetch = vi.fn()

const uploadResponse = (fileId: string, fileName: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ fileId, fileName, mimeType: 'image/png', fileSize: 10 }),
})

const makeFile = (name: string) => new File(['x'], name, { type: 'image/png' })

const renderInput = (props: Partial<React.ComponentProps<typeof RichTextInput>> = {}) => {
  const onAttachedFilesChange = vi.fn()
  const utils = render(
    <RichTextInput
      value=""
      onChange={vi.fn()}
      onSend={vi.fn()}
      currentUserId="user-1"
      enableAttachments
      uploadContext={{ taskId: 'task-1' }}
      attachedFiles={[]}
      onAttachedFilesChange={onAttachedFilesChange}
      {...props}
    />,
  )
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  return { ...utils, input, onAttachedFilesChange }
}

describe('RichTextInput attachments (Task 9f325964)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets the OS picker select more than one file', () => {
    const { input } = renderInput()

    expect(input.multiple).toBe(true)
  })

  it('stages every picked file instead of only the first', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(uploadResponse('id-1', 'one.png'))
      .mockResolvedValueOnce(uploadResponse('id-2', 'two.png'))

    const { input, onAttachedFilesChange } = renderInput()

    fireEvent.change(input, { target: { files: [makeFile('one.png'), makeFile('two.png')] } })

    await waitFor(() => expect(onAttachedFilesChange).toHaveBeenCalled())

    const staged = onAttachedFilesChange.mock.calls.at(-1)![0]
    expect(staged.map((f: { name: string }) => f.name)).toEqual(['one.png', 'two.png'])
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps files already staged when another is picked', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(uploadResponse('id-2', 'two.png'))

    const existing = [{ url: '/api/secure-files/id-1', name: 'one.png', type: 'image/png', size: 10 }]
    const { input, onAttachedFilesChange } = renderInput({ attachedFiles: existing })

    fireEvent.change(input, { target: { files: [makeFile('two.png')] } })

    await waitFor(() => expect(onAttachedFilesChange).toHaveBeenCalled())

    const staged = onAttachedFilesChange.mock.calls.at(-1)![0]
    expect(staged.map((f: { name: string }) => f.name)).toEqual(['one.png', 'two.png'])
  })

  it('renders a removable row per staged file', () => {
    const staged = [
      { url: '/api/secure-files/id-1', name: 'one.png', type: 'image/png', size: 10 },
      { url: '/api/secure-files/id-2', name: 'two.png', type: 'image/png', size: 10 },
    ]
    const { getByLabelText, getByText, onAttachedFilesChange } = renderInput({ attachedFiles: staged })

    expect(getByText('one.png')).toBeInTheDocument()
    expect(getByText('two.png')).toBeInTheDocument()

    fireEvent.click(getByLabelText('Remove one.png'))

    expect(onAttachedFilesChange).toHaveBeenCalledWith([staged[1]])
  })
})
