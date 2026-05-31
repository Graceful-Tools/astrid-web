/**
 * @vitest-environment jsdom
 */

/**
 * Task 17745aa8 — project board #6: the Edit Project metadata dialog. Wires
 * name/description/color/imageUrl to PATCH /api/projects/[id].
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditProjectDialog, type EditableProject } from '@/components/EditProjectDialog'

const project: EditableProject = {
  id: 'proj-1',
  name: 'My Project',
  description: 'old desc',
  color: '#3b82f6',
  imageUrl: null,
}

function setup(overrides: Partial<React.ComponentProps<typeof EditProjectDialog>> = {}) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <EditProjectDialog
      open
      onOpenChange={onOpenChange}
      project={project}
      onSaved={onSaved}
      {...overrides}
    />
  )
  return { onSaved, onOpenChange }
}

describe('EditProjectDialog (task 17745aa8 — board #6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('seeds the form from the project', () => {
    setup()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My Project')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('old desc')
  })

  it('disables Save when the name is blank', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('PATCHes the project and calls onSaved + closes on success', async () => {
    const updated = { ...project, name: 'Renamed', description: 'new desc' }
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ project: updated }) } as Response)
    ) as typeof fetch

    const { onSaved, onOpenChange } = setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'new desc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/projects/proj-1',
      expect.objectContaining({ method: 'PATCH' })
    )
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body).toMatchObject({ name: 'Renamed', description: 'new desc', color: '#3b82f6', imageUrl: null })
  })

  it('shows a server error and stays open on failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Only the owner can edit this project' }) } as Response)
    ) as typeof fetch

    const { onSaved, onOpenChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByText('Only the owner can edit this project')).toBeInTheDocument()
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
