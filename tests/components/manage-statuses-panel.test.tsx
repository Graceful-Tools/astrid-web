/**
 * @vitest-environment jsdom
 */

/**
 * The board's "Statuses" settings tab.
 *
 * **What is editable narrowed with Stage D (task b7b0c2f5).** Every column
 * used to be a `listType: 'status'` TaskList, so the panel renamed and
 * reordered them with PUT /api/v1/lists/[id]. Those rows are deleted, and a
 * column is now one of two things:
 *
 *   - Ready / Doing / Waiting — `DEFAULT_STATES` config, shared by every board
 *     of every user, with no per-board place to store an edit. Read-only.
 *   - a custom column — stored on `Project.customStates`, renamed through
 *     PATCH /api/statuses.
 *
 * These tests pin that split, because "the tab is empty" and "the tab silently
 * PUTs a list that does not exist" are both things that would ship green
 * otherwise.
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
]

function setup() {
  const onChanged = vi.fn()
  render(<ManageStatusesPanel statuses={statuses} onChanged={onChanged} projectId="p1" />)
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
    // The tab used to be fed the status ROWS. Reading rows after Stage D shows
    // an empty tab — the failure this asserts against.
    setup()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Doing')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
  })

  it('marks the built-ins read-only and offers no rename for them', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Rename Ready/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Rename Doing/ })).toBeNull()
    expect(screen.getAllByText('Built-in')).toHaveLength(2)
  })

  it('renames a custom column via PATCH /api/statuses, keyed on its role', async () => {
    // The ROLE, not a list id: a task points at its column by `statusRole`, so
    // renaming must not mint a new one or every card in the column is orphaned.
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

  it('never PUTs a list — those rows are gone', async () => {
    okFetch()
    setup()

    fireEvent.click(screen.getByRole('button', { name: /Rename Blocked/ }))
    fireEvent.change(screen.getByDisplayValue('Blocked'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(calls().some(([url]) => String(url).includes('/api/v1/lists/'))).toBe(false)
  })

  it('adds a custom status via POST /api/statuses', async () => {
    okFetch()
    const { onChanged } = setup()

    fireEvent.change(screen.getByPlaceholderText('New status name'), { target: { value: 'Blocked' } })
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith('/api/statuses', expect.objectContaining({ method: 'POST' }))
    // REGRESSION (task 109d8a91): without the board id the state has nowhere
    // to be stored, and the status renders on no board at all.
    expect(JSON.parse(calls()[0][1].body)).toMatchObject({ name: 'Blocked', projectId: 'p1' })
  })
})
