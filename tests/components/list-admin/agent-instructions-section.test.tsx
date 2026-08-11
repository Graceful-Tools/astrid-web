/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the Agent Instructions editor
 * (the list-description inline editor, with markdown preview + starter
 * templates) out of components/list-admin-settings.tsx into
 * components/list-admin/AgentInstructionsSection.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentInstructionsSection } from '@/components/list-admin/AgentInstructionsSection'
import type { TaskList } from '@/types/task'

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test List',
    description: '',
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

describe('AgentInstructionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <AgentInstructionsSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the empty-state prompt when the list has no instructions', () => {
    render(<AgentInstructionsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    expect(screen.getByText(/Click to add agent instructions/)).toBeInTheDocument()
  })

  it('titles the section "List Description" with an info hint about agent usage (task 3fa1be3a)', () => {
    render(<AgentInstructionsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    // Renamed from "Agent Instructions" back to "List Description".
    expect(screen.getByText('List Description')).toBeInTheDocument()
    expect(screen.queryByText('Agent Instructions')).not.toBeInTheDocument()
    // An info affordance explains the description is used as agent instructions.
    expect(
      screen.getByLabelText(/used as instructions for ai agents/i)
    ).toBeInTheDocument()
  })

  it('enters edit mode with a textarea when the display area is clicked', () => {
    render(
      <AgentInstructionsSection
        list={makeList({ description: 'Be helpful.' })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Click to edit'))
    const textarea = screen.getByPlaceholderText(/Write instructions for AI agents/) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toBe('Be helpful.')
  })

  it('fills the editor from a starter template', () => {
    render(<AgentInstructionsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    fireEvent.click(screen.getByText(/Click to add agent instructions/))
    fireEvent.click(screen.getByText('Starter templates'))
    fireEvent.click(screen.getByText('Code Reviewer'))

    const textarea = screen.getByPlaceholderText(/Write instructions for AI agents/) as HTMLTextAreaElement
    expect(textarea.value).toContain('Review code changes')
  })

  it('reverts and exits edit mode when Cancel is clicked', () => {
    render(
      <AgentInstructionsSection
        list={makeList({ description: 'Original.' })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Click to edit'))
    const textarea = screen.getByPlaceholderText(/Write instructions for AI agents/)
    fireEvent.change(textarea, { target: { value: 'Changed but discarded' } })
    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByPlaceholderText(/Write instructions for AI agents/)).not.toBeInTheDocument()
    expect(screen.getByText('Click to edit')).toBeInTheDocument()
  })

  it('PUTs the updated description and calls onUpdate when saved', async () => {
    const updated = makeList({ description: 'New instructions' })
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(updated) } as Response)
    ) as typeof fetch
    const onUpdate = vi.fn()

    render(
      <AgentInstructionsSection
        list={makeList({ description: 'Old' })}
        canEditSettings={true}
        onUpdate={onUpdate}
      />
    )
    fireEvent.click(screen.getByText('Click to edit'))
    const textarea = screen.getByPlaceholderText(/Write instructions for AI agents/)
    fireEvent.change(textarea, { target: { value: 'New instructions' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(updated))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/lists/list-1',
      expect.objectContaining({ method: 'PUT' })
    )
  })
})
