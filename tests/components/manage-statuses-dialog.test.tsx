/**
 * @vitest-environment jsdom
 */

/**
 * Task 1c7817f9 — project board #5: rename / reorder / add board statuses.
 * Statuses are per-user globals; the dialog wires to PUT /api/lists/[id]
 * (rename/reorder) and POST /api/statuses (add).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ManageStatusesDialog } from '@/components/ManageStatusesDialog'
import type { TaskList } from '@/types/task'

const statuses = [
  { id: 'ready', name: 'Ready', statusOrder: 0, listType: 'status' },
  { id: 'doing', name: 'Doing', statusOrder: 1, listType: 'status' },
] as unknown as TaskList[]

function setup() {
  const onChanged = vi.fn()
  render(<ManageStatusesDialog open onOpenChange={vi.fn()} statuses={statuses} onChanged={onChanged} />)
  return { onChanged }
}

function okFetch() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  ) as typeof fetch
}

describe('ManageStatusesDialog (task 1c7817f9 — board #5)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the statuses in order and warns they are global', () => {
    setup()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText(/all/)).toBeInTheDocument()
  })

  it('renames via PUT /api/lists/[id] and refreshes', async () => {
    okFetch()
    const { onChanged } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Rename Ready/ }))
    fireEvent.change(screen.getByDisplayValue('Ready'), { target: { value: 'Backlog' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/lists/ready', expect.objectContaining({ method: 'PUT' }))
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.name).toBe('Backlog')
  })

  it('reorders by swapping statusOrder on both lists', async () => {
    okFetch()
    const { onChanged } = setup()
    // Move "Doing" up (it is the second row, index 1).
    const doingRow = screen.getByTestId('status-row-doing')
    fireEvent.click(within(doingRow).getByLabelText('Move up'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('adds a custom status via POST /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()
    fireEvent.change(screen.getByPlaceholderText('New status name'), { target: { value: 'Blocked' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.name).toBe('Blocked')
  })
})
