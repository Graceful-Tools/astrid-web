/**
 * MCP attachments render, and render the right way (task AWTD-803).
 *
 * The legacy `Attachment` model — written only by the two MCP handlers — had no
 * reader in the product: `collectTaskAttachments` walked `secureFiles` only, so
 * a file attached through MCP was loaded by the route, shipped to the client and
 * dropped. `tests/lib/task-attachments.test.ts` pins the collection itself.
 *
 * This pins the half that would turn one bug into another. The two models are
 * served differently: a `SecureFile` resolves through
 * /api/v1/secure-files/{id}?info=true, while a legacy row carries a plain url
 * and has no record there. Listing legacy rows without telling the viewer so
 * would trade an invisible attachment for a broken one.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskActivitySection } from '@/components/task-detail/TaskActivitySection'

vi.mock('@/components/secure-attachment-viewer', () => ({
  SecureAttachmentViewer: ({ fileId, directFile }: { fileId: string; directFile?: { url: string } }) => (
    <div data-testid="attachment" data-file-id={fileId} data-direct-url={directFile?.url ?? ''} />
  ),
}))
vi.mock('@/components/task-timer', () => ({ TaskTimer: () => <div /> }))

const task = {
  id: 'task-1',
  attachments: [{
    id: 'mcp-1',
    name: 'spec.pdf',
    url: 'https://files.example/spec.pdf',
    type: 'application/pdf',
    size: 99,
    taskId: 'task-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
  }],
  secureFiles: [{
    id: 'sf-1',
    blobUrl: 'https://blob/sf-1',
    originalName: 'photo.png',
    mimeType: 'image/png',
    fileSize: 10,
    uploadedBy: 'u1',
    taskId: 'task-1',
    commentId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }],
  comments: [],
} as never

function renderSection() {
  return render(
    <TaskActivitySection task={task} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />
  )
}

describe('TaskActivitySection attachments (task AWTD-803)', () => {
  it('renders the MCP attachment alongside the secure file', () => {
    renderSection()

    expect(screen.getAllByTestId('attachment').map(el => el.getAttribute('data-file-id')))
      .toEqual(['sf-1', 'mcp-1'])
  })

  it('hands the MCP attachment its own url instead of a secure-files lookup', () => {
    renderSection()

    const [secure, legacy] = screen.getAllByTestId('attachment')
    expect(secure.getAttribute('data-direct-url')).toBe('')
    expect(legacy.getAttribute('data-direct-url')).toBe('https://files.example/spec.pdf')
  })

  it('counts both models in the heading', () => {
    renderSection()

    expect(screen.getByText('Attachments (2)')).toBeTruthy()
  })
})
