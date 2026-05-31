/**
 * @vitest-environment jsdom
 */

/**
 * Task 900732d2 — Stage 22: the "activity" sub-view (attachments + timer)
 * extracted from task-detail.tsx. Completes the header/fields/activity/modals
 * split. Children (SecureAttachmentViewer, TaskTimer) are mocked so the tests
 * cover this sub-view's own wiring.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskActivitySection } from '@/components/task-detail/TaskActivitySection'
import type { Task } from '@/types/task'

vi.mock('@/components/secure-attachment-viewer', () => ({
  SecureAttachmentViewer: ({ fileId }: { fileId: string }) => (
    <div data-testid="attachment" data-file-id={fileId} />
  ),
}))

vi.mock('@/components/task-timer', () => ({
  TaskTimer: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="task-timer">
      <button data-testid="timer-close" onClick={onClose}>close</button>
    </div>
  ),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Test', comments: [], ...overrides } as unknown as Task
}

describe('TaskActivitySection (Stage 22 / task 900732d2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders no attachments block when comments have no secure files', () => {
    render(<TaskActivitySection task={makeTask()} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(screen.queryByText(/Attachments/)).not.toBeInTheDocument()
  })

  it('collects secure-file attachments from comments and renders one viewer each', () => {
    const task = makeTask({
      comments: [
        { id: 'c1', createdAt: '2026-01-01', secureFiles: [{ id: 'f1', originalName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 }] },
        { id: 'c2', createdAt: '2026-01-02', secureFiles: [{ id: 'f2', originalName: 'b.png', mimeType: 'image/png', fileSize: 20 }] },
      ] as never,
    })
    render(<TaskActivitySection task={task} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByText('Attachments (2)')).toBeInTheDocument()
    const viewers = screen.getAllByTestId('attachment')
    expect(viewers).toHaveLength(2)
    expect(viewers[0]).toHaveAttribute('data-file-id', 'f1')
    expect(viewers[1]).toHaveAttribute('data-file-id', 'f2')
  })

  it('opens the timer when the Timer button is clicked', () => {
    const setShowTimer = vi.fn()
    render(<TaskActivitySection task={makeTask()} showTimer={false} setShowTimer={setShowTimer} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Timer/ }))
    expect(setShowTimer).toHaveBeenCalledWith(true)
  })

  it('renders the TaskTimer modal only when showTimer is true', () => {
    const { rerender } = render(
      <TaskActivitySection task={makeTask()} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />
    )
    expect(screen.queryByTestId('task-timer')).not.toBeInTheDocument()
    rerender(<TaskActivitySection task={makeTask()} showTimer={true} setShowTimer={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByTestId('task-timer')).toBeInTheDocument()
  })

  it('shows the last timer value when present', () => {
    render(<TaskActivitySection task={makeTask({ lastTimerValue: '25:00' } as never)} showTimer={false} setShowTimer={vi.fn()} onUpdate={vi.fn()} />)
    expect(screen.getByText('Last: 25:00')).toBeInTheDocument()
  })
})
