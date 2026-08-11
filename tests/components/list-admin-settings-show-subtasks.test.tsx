import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ListAdminSettings } from '@/components/list-admin-settings'
import type { TaskList, User } from '@/types/task'

// Task dce843a1 — the per-list "Show subtasks" toggle in list settings.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

global.fetch = vi.fn(async () => new Response(JSON.stringify({ repositories: [], aiProviders: [], agents: [] }), {
  headers: { 'Content-Type': 'application/json' },
})) as unknown as typeof fetch

const currentUser = {
  id: 'u-1',
  email: 'u@example.com',
  name: 'U',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as User

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test',
    privacy: 'PRIVATE',
    owner: currentUser,
    ownerId: 'u-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lists: [],
    ...overrides,
  } as unknown as TaskList
}

function renderSettings(list: TaskList, onUpdate: (l: TaskList) => void = () => {}, canEditSettings = true) {
  return render(
    <ListAdminSettings
      list={list}
      currentUser={currentUser}
      canEditSettings={canEditSettings}
      onUpdate={onUpdate}
      onDelete={() => {}}
    />,
  )
}

describe('ListAdminSettings — Show subtasks toggle', () => {
  it('renders the section for a user who can edit settings', () => {
    const { getByTestId } = renderSettings(makeList())
    expect(getByTestId('show-subtasks-section')).toBeTruthy()
    expect(getByTestId('show-subtasks-toggle')).toBeTruthy()
  })

  it('is ON for a list that predates the column (showSubtasks absent)', () => {
    // Absent must read as SHOW — otherwise every existing list looks like it
    // was deliberately switched off.
    const { getByTestId } = renderSettings(makeList({ showSubtasks: undefined }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('checked')
  })

  it('is OFF for a list that opted out', () => {
    const { getByTestId } = renderSettings(makeList({ showSubtasks: false }))
    expect(getByTestId('show-subtasks-toggle').getAttribute('data-state')).toBe('unchecked')
  })

  it('sends the boolean up on toggle so it reaches the API as a real boolean', () => {
    const onUpdate = vi.fn()
    const { getByTestId } = renderSettings(makeList({ showSubtasks: true }), onUpdate)
    fireEvent.click(getByTestId('show-subtasks-toggle'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0].showSubtasks).toBe(false)
  })

  it('is hidden from someone who cannot edit list settings', () => {
    const { queryByTestId } = renderSettings(makeList(), () => {}, false)
    expect(queryByTestId('show-subtasks-section')).toBeNull()
  })
})
