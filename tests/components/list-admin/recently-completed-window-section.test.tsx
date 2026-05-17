/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the "Recently completed window"
 * advanced setting out of components/list-admin-settings.tsx into
 * components/list-admin/RecentlyCompletedWindowSection.tsx.
 *
 * The section is purely derived from list.recentlyCompletedWindow (no
 * local state) — these pin gating, the preset control, and the inline
 * date input shown for the since-specific-date preset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecentlyCompletedWindowSection } from '@/components/list-admin/RecentlyCompletedWindowSection'
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

describe('RecentlyCompletedWindowSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <RecentlyCompletedWindowSection
        list={makeList()}
        canEditSettings={false}
        onUpdate={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the advanced section with the preset control for an editor', () => {
    render(
      <RecentlyCompletedWindowSection
        list={makeList()}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.getByText('Advanced — Recently completed window')).toBeInTheDocument()
    expect(screen.getByTestId('recently-completed-preset-trigger')).toBeInTheDocument()
  })

  it('shows the inline date input when the window is a specific date', () => {
    render(
      <RecentlyCompletedWindowSection
        list={makeList({
          recentlyCompletedWindow: { kind: 'since-date', date: '2026-05-01' },
        })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    const dateInput = screen.getByTestId('recently-completed-specific-date') as HTMLInputElement
    expect(dateInput).toBeInTheDocument()
    expect(dateInput.value).toBe('2026-05-01')
  })

  it('hides the date input for a duration-based window', () => {
    render(
      <RecentlyCompletedWindowSection
        list={makeList({
          recentlyCompletedWindow: { kind: 'duration', amount: 7, unit: 'day' },
        })}
        canEditSettings={true}
        onUpdate={vi.fn()}
      />
    )
    expect(screen.queryByTestId('recently-completed-specific-date')).not.toBeInTheDocument()
  })
})
