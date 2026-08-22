/**
 * @vitest-environment jsdom
 */

/**
 * The board's "Statuses" settings tab.
 *
 * **What is editable changed with Stage D (task b7b0c2f5) and this task.**
 * Every column used to be a `listType: 'status'` TaskList; those rows are
 * deleted. A column is now one of two things:
 *
 *   - Ready / Doing / Waiting — `DEFAULT_STATES` config. Can be renamed via
 *     PATCH /api/statuses; cannot be reordered or deleted.
 *   - a custom column — stored on `Project.customStates`. Rename (PATCH),
 *     reorder (PUT), and delete (DELETE) are all wired to /api/statuses.
 *
 * These tests pin that contract.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ManageStatusesPanel } from '@/components/list-admin/ManageStatusesPanel'
import type { ProjectBoardColumn } from '@/lib/project-status'

const statuses: ProjectBoardColumn[] = [
  { id: 'ready', name: 'Ready', description: '', kind: 'status' },
  { id: 'doing', name: 'Doing', description: '', kind: 'status' },
  { id: 'custom-blocked', name: 'Blocked', description: '', kind: 'status' },
  { id: 'custom-review', name: 'In Review', description: '', kind: 'status' },
]

function setup(overrideStatuses?: ProjectBoardColumn[]) {
  const onChanged = vi.fn()
  render(<ManageStatusesPanel statuses={overrideStatuses ?? statuses} onChanged={onChanged} projectId="p1" />)
  return { onChanged }
}

function okFetch() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  ) as typeof fetch
}

const calls = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls

describe('ManageStatusesPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists every column the board renders, built-ins included', () => {
    setup()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })

  it('offers a rename button for ALL columns, including built-ins', () => {
    setup()
    expect(screen.getByRole('button', { name: /Rename Ready/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rename Doing/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rename Blocked/ })).toBeInTheDocument()
  })

  it('does NOT show up/down buttons for built-in columns', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Move Ready/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Move Doing/ })).toBeNull()
  })

  it('does NOT show a delete button for built-in columns', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Delete Ready/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete Doing/ })).toBeNull()
  })

  it('shows up/down and delete buttons for custom columns', () => {
    setup()
    expect(screen.getByRole('button', { name: /Move Blocked up/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Move Blocked down/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Delete Blocked/ })).toBeInTheDocument()
  })

  // ── Rename ──────────────────────────────────────────────────────────────

  it('renames a custom column via PATCH /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.click(screen.getByRole('button', { name: /Rename Blocked/ }))
    fireEvent.change(screen.getByDisplayValue('Blocked'), { target: { value: 'Waiting on legal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({
      role: 'custom-blocked',
      name: 'Waiting on legal',
      projectId: 'p1',
    })
  })

  it('renames a built-in column via PATCH /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.click(screen.getByRole('button', { name: /Rename Ready/ }))
    fireEvent.change(screen.getByDisplayValue('Ready'), { target: { value: 'Starting' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({
      role: 'ready',
      name: 'Starting',
      projectId: 'p1',
    })
  })

  it('never PUTs a list — those rows are gone', async () => {
    okFetch()
    setup()

    fireEvent.click(screen.getByRole('button', { name: /Rename Blocked/ }))
    fireEvent.change(screen.getByDisplayValue('Blocked'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(calls().some(([url]) => String(url).includes('/api/v1/lists/'))).toBe(false)
  })

  // ── Reorder ─────────────────────────────────────────────────────────────

  it('moves a custom column up via PUT /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    // "In Review" is the second custom column; moving it up should trigger PUT.
    fireEvent.click(screen.getByRole('button', { name: /Move In Review up/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'PUT' }))
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({
      role: 'custom-review',
      direction: 'up',
      projectId: 'p1',
    })
  })

  it('moves a custom column down via PUT /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.click(screen.getByRole('button', { name: /Move Blocked down/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({
      role: 'custom-blocked',
      direction: 'down',
      projectId: 'p1',
    })
  })

  it('disables the up button on the first custom column', () => {
    setup()
    expect(screen.getByRole('button', { name: /Move Blocked up/ })).toBeDisabled()
  })

  it('disables the down button on the last custom column', () => {
    setup()
    expect(screen.getByRole('button', { name: /Move In Review down/ })).toBeDisabled()
  })

  // ── Delete ───────────────────────────────────────────────────────────────

  it('deletes a custom column via DELETE /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.click(screen.getByRole('button', { name: /Delete Blocked/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'DELETE' }))
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({
      role: 'custom-blocked',
      projectId: 'p1',
    })
  })

  // ── Add ──────────────────────────────────────────────────────────────────

  it('adds a custom status via POST /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.change(screen.getByPlaceholderText('New status name'), { target: { value: 'Blocked' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({ name: 'Blocked', projectId: 'p1' })
  })
})

