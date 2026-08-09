/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the inline List Name editor out of
 * components/list-admin-settings.tsx into
 * components/list-admin/ListNameSection.tsx (unblocked by the
 * useClickOutsideSave untangle).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListNameSection } from '@/components/list-admin/ListNameSection'
import { EditingSessionProvider, useSharedEditingSession } from '@/hooks/use-editing-session'
import type { TaskList } from '@/types/task'

vi.mock('@/lib/layout-detection', () => ({
  shouldPreventAutoFocus: () => false,
}))

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    admins: [],
    tasks: [],
    ...overrides,
  } as TaskList
}

describe('ListNameSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <ListNameSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the list name in display mode for an editor', () => {
    render(
      <ListNameSection list={makeList({ name: 'Groceries' })} canEditSettings={true} onUpdate={vi.fn()} />
    )
    expect(screen.getByText('List Name')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('enters edit mode with an input prefilled when the name is clicked', () => {
    render(
      <ListNameSection list={makeList({ name: 'Groceries' })} canEditSettings={true} onUpdate={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Groceries'))
    const input = screen.getByDisplayValue('Groceries') as HTMLInputElement
    expect(input).toBeInTheDocument()
  })

  it('exits edit mode without saving when Escape is pressed', () => {
    render(
      <ListNameSection list={makeList({ name: 'Groceries' })} canEditSettings={true} onUpdate={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Groceries'))
    const input = screen.getByDisplayValue('Groceries')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByDisplayValue('Groceries')).not.toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('PUTs the renamed list and calls onUpdate when the change is saved', async () => {
    const updated = makeList({ name: 'Renamed' })
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(updated) } as Response)
    ) as typeof fetch
    const onUpdate = vi.fn()

    render(
      <ListNameSection list={makeList({ name: 'Groceries' })} canEditSettings={true} onUpdate={onUpdate} />
    )
    fireEvent.click(screen.getByText('Groceries'))
    const input = screen.getByDisplayValue('Groceries')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(updated))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/lists/list-1',
      expect.objectContaining({ method: 'PUT' })
    )
  })
})


describe('ListNameSection joins the shared editing session (task 7b60c7c5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(makeList({ name: 'Renamed' })) } as Response),
    ) as typeof fetch
  })

  const openEditor = () => fireEvent.click(screen.getByText('Test List'))

  it('reverts the draft on Cancel instead of leaving it staged', async () => {
    // The bug: Escape / X closed the editor but never reset tempListName, so
    // the abandoned text was still sitting in the buffer when it reopened.
    // Cancel is the ONE transition that discards — it has to actually discard.
    render(
      <EditingSessionProvider>
        <ListNameSection list={makeList()} canEditSettings onUpdate={vi.fn()} />
      </EditingSessionProvider>,
    )

    openEditor()
    fireEvent.change(screen.getByDisplayValue('Test List'), { target: { value: 'Abandoned' } })
    fireEvent.keyDown(screen.getByDisplayValue('Abandoned'), { key: 'Escape' })

    openEditor()
    expect(screen.getByRole('textbox')).toHaveValue('Test List')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('opening another editor commits this one rather than dropping the edit', async () => {
    function Other() {
      const session = useSharedEditingSession()
      return <button onClick={() => session.beginEditing('other')}>open other</button>
    }

    render(
      <EditingSessionProvider>
        <ListNameSection list={makeList()} canEditSettings onUpdate={vi.fn()} />
        <Other />
      </EditingSessionProvider>,
    )

    openEditor()
    fireEvent.change(screen.getByDisplayValue('Test List'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByText('open other'))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/lists/list-1',
      expect.objectContaining({ method: 'PUT' }),
    ))
  })
})
