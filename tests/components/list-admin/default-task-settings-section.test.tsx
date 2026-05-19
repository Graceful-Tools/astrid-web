/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the default-task-settings block
 * (Default Priority / Assignee / When / Repeating / When Time) out of
 * components/list-admin-settings.tsx into
 * components/list-admin/DefaultTaskSettingsSection.tsx.
 *
 * This block owns 11 temp/editing state vars + the temp-state-sync
 * effect — the last saga bundled in the parent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DefaultTaskSettingsSection } from '@/components/list-admin/DefaultTaskSettingsSection'
import type { TaskList } from '@/types/task'

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

describe('DefaultTaskSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <DefaultTaskSettingsSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the default-setting rows for an editor', () => {
    render(<DefaultTaskSettingsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    expect(screen.getByText('Default Priority')).toBeInTheDocument()
    expect(screen.getByText('Default Assignee')).toBeInTheDocument()
    expect(screen.getByText('Default When')).toBeInTheDocument()
    expect(screen.getByText('Default When Time')).toBeInTheDocument()
  })

  it('hides Default Repeating when there is no default due date', () => {
    render(
      <DefaultTaskSettingsSection
        list={makeList({ defaultDueDate: 'none' })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.queryByText('Default Repeating')).not.toBeInTheDocument()
  })

  it('shows Default Repeating once a default due date is set', () => {
    render(
      <DefaultTaskSettingsSection
        list={makeList({ defaultDueDate: 'today' })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByText('Default Repeating')).toBeInTheDocument()
  })

  it('shows the current Default When value', () => {
    render(
      <DefaultTaskSettingsSection
        list={makeList({ defaultDueDate: 'today' })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('defaults the assignee display to Task Creator', () => {
    render(<DefaultTaskSettingsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    expect(screen.getByText('Task Creator')).toBeInTheDocument()
  })

  it('opens the Default When picker and saves a chosen date', () => {
    const onUpdate = vi.fn()
    render(<DefaultTaskSettingsSection list={makeList()} canEditSettings={true} onUpdate={onUpdate} />)

    // Default is "No default when" — click it to open the picker.
    fireEvent.click(screen.getByText('No default when'))
    fireEvent.click(screen.getByText('Tomorrow'))

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ defaultDueDate: 'tomorrow' })
    )
  })

  it('enters assignee edit mode (a select) when the assignee display is clicked', () => {
    render(<DefaultTaskSettingsSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    // Display mode: no combobox, just the clickable "Task Creator" label.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Task Creator'))
    // Edit mode renders the assignee Select.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
