/**
 * @vitest-environment jsdom
 */

/**
 * The list editors obey "one editing session at a time" (task 7b60c7c5).
 *
 * The per-section tests cover each editor's own save/cancel behaviour. This one
 * covers the property that only exists once they share a session: opening one
 * closes the others, across component boundaries. It is the thing that silently
 * would not hold if a future editor called `useEditingSession` directly instead
 * of `useSharedEditingSession`.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ListNameSection } from '@/components/list-admin/ListNameSection'
import { AgentInstructionsSection } from '@/components/list-admin/AgentInstructionsSection'
import { EditingSessionProvider } from '@/hooks/use-editing-session'
import type { TaskList } from '@/types/task'

vi.mock('@/lib/layout-detection', () => ({
  shouldPreventAutoFocus: () => false,
  isMobileDevice: () => false,
}))

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test List',
    description: 'Original instructions',
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

describe('list editors share one session (task 7b60c7c5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(makeList()) } as Response),
    ) as typeof fetch
  })

  const renderBoth = () => {
    const list = makeList()
    return render(
      <EditingSessionProvider>
        <ListNameSection list={list} canEditSettings onUpdate={vi.fn()} />
        <AgentInstructionsSection list={list} canEditSettings onUpdate={vi.fn()} />
      </EditingSessionProvider>,
    )
  }

  it('opening the instructions editor closes the name editor', async () => {
    renderBoth()

    fireEvent.click(screen.getByText('Test List'))
    expect(screen.getByDisplayValue('Test List')).toBeInTheDocument()

    // Open the other editor — whichever control reveals it.
    const instructionsOpener = screen.getByText(/Original instructions/)
    fireEvent.click(instructionsOpener)

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Test List')).not.toBeInTheDocument()
    })
  })

  it('the hand-off saves the name that was being typed', async () => {
    renderBoth()

    fireEvent.click(screen.getByText('Test List'))
    fireEvent.change(screen.getByDisplayValue('Test List'), { target: { value: 'Renamed' } })

    fireEvent.click(screen.getByText(/Original instructions/))

    // Commit-on-resign: opening another editor SAVES, it does not discard.
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/lists/list-1',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.name).toBe('Renamed')
  })
})
