import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ListAdminSettings } from '@/components/list-admin-settings'
import type { TaskList, User } from '@/types/task'

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

describe('ListAdminSettings — Recently Completed window dropdown (task: per-list recently-completed)', () => {
  it('renders the Advanced section with the dropdown when the user can edit', () => {
    const { getByTestId, getByText } = render(
      <ListAdminSettings
        list={makeList()}
        currentUser={currentUser}
        canEditSettings={true}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(getByTestId('advanced-settings-section')).toBeTruthy()
    expect(getByTestId('recently-completed-preset-trigger')).toBeTruthy()
    expect(getByText(/Recently completed/)).toBeTruthy()
  })

  it('shows the default preset label when the list has no window set', () => {
    const { getByTestId } = render(
      <ListAdminSettings
        list={makeList({ recentlyCompletedWindow: null })}
        currentUser={currentUser}
        canEditSettings={true}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    )

    const trigger = getByTestId('recently-completed-preset-trigger')
    expect(trigger.textContent).toMatch(/Last 24 hours/)
  })

  it('shows the inline date picker when the since-specific-date window is set', () => {
    const { getByTestId } = render(
      <ListAdminSettings
        list={makeList({ recentlyCompletedWindow: { kind: 'since-date', date: '2026-04-01' } as unknown as TaskList['recentlyCompletedWindow'] })}
        currentUser={currentUser}
        canEditSettings={true}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(getByTestId('recently-completed-specific-date')).toBeTruthy()
  })

  it('does NOT show the date picker when a non-date preset is selected', () => {
    const { container } = render(
      <ListAdminSettings
        list={makeList({ recentlyCompletedWindow: { kind: 'duration', amount: 7, unit: 'day' } as unknown as TaskList['recentlyCompletedWindow'] })}
        currentUser={currentUser}
        canEditSettings={true}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(container.querySelector('[data-testid="recently-completed-specific-date"]')).toBeNull()
  })

  it('typing in the specific-date input persists a since-date window via onUpdate', () => {
    const onUpdate = vi.fn()
    const { getByTestId } = render(
      <ListAdminSettings
        list={makeList({ recentlyCompletedWindow: { kind: 'since-date', date: '2026-04-01' } as unknown as TaskList['recentlyCompletedWindow'] })}
        currentUser={currentUser}
        canEditSettings={true}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />,
    )

    const dateInput = getByTestId('recently-completed-specific-date') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-05-01' } })

    expect(onUpdate).toHaveBeenCalled()
    const arg = onUpdate.mock.calls[0][0]
    expect(arg.recentlyCompletedWindow).toEqual({ kind: 'since-date', date: '2026-05-01' })
  })
})
