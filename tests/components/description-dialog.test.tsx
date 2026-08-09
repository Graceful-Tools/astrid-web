/**
 * @vitest-environment jsdom
 */

/**
 * Task 5aad267a — Stage 21: extracting the View/Edit Agent Instructions
 * (description) modal out of MainContent.tsx into
 * components/TaskManager/MainContent/DescriptionDialog.tsx.
 *
 * The dialog owns its open/mode/draft state and is opened imperatively
 * via a ref handle. No behavior change from the inline version.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import {
  DescriptionDialog,
  type DescriptionDialogHandle,
} from '@/components/TaskManager/MainContent/DescriptionDialog'
import type { TaskList } from '@/types/task'

const list = {
  id: 'list-1',
  name: 'Engineering',
  description: 'Initial instructions',
} as unknown as TaskList

function renderDialog(overrides: Partial<React.ComponentProps<typeof DescriptionDialog>> = {}) {
  const ref = React.createRef<DescriptionDialogHandle>()
  const onListUpdate = vi.fn(() => Promise.resolve())
  const setTempListDescription = vi.fn()
  render(
    <DescriptionDialog
      ref={ref}
      currentList={list}
      canEditSettings={true}
      isViewingFromFeatured={false}
      setTempListDescription={setTempListDescription}
      onListUpdate={onListUpdate}
      {...overrides}
    />
  )
  return { ref, onListUpdate, setTempListDescription }
}

describe('DescriptionDialog (Stage 21 / task 5aad267a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing until opened via the ref handle', () => {
    renderDialog()
    expect(screen.queryByText('List Description')).not.toBeInTheDocument()
  })

  it('opens in view mode showing the list name and description', () => {
    const { ref } = renderDialog()
    act(() => ref.current!.open('Hello world'))
    expect(screen.getByText('List Description')).toBeInTheDocument()
    expect(screen.getByText(/Engineering/)).toBeInTheDocument()
    // View mode renders markdown, not a textarea
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('toggles between view and edit modes', () => {
    const { ref } = renderDialog()
    act(() => ref.current!.open('Hello world'))

    // Enter edit mode → textarea appears, seeded from the list description
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('Initial instructions')

    // Back to view mode → textarea gone
    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('PUTs /api/v1/lists/[id] and calls onListUpdate when saving a changed description', async () => {
    const updated = { ...list, description: 'New instructions' }
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(updated) } as Response)
    ) as typeof fetch

    const { ref, onListUpdate, setTempListDescription } = renderDialog()
    act(() => ref.current!.open('Initial instructions'))

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New instructions' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(onListUpdate).toHaveBeenCalledWith(updated))
    expect(setTempListDescription).toHaveBeenCalledWith('New instructions')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/lists/list-1',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('hides the edit toggle when the user cannot edit settings', () => {
    const { ref } = renderDialog({ canEditSettings: false })
    act(() => ref.current!.open('Read only'))
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
  })
})
