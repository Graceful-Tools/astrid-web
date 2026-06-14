/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13 step 1: smoke render coverage for
 * components/list-admin-settings.tsx (1322 lines) BEFORE the planned
 * 8-way split into components/list-admin/.
 *
 * The existing suites are narrow — list-admin-settings.test.tsx covers
 * only the Delete modal, list-admin-settings-recently-completed.test.tsx
 * only the recently-completed window. This file renders the component
 * across its main prop configurations and asserts it mounts without
 * throwing, so any extraction that breaks a config is caught.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ListAdminSettings } from '@/components/list-admin-settings'
import type { TaskList, User } from '@/types/task'

// Component fires effects that fetch repos / agents / AI providers on
// mount — return a superset payload with .ok so none of them throw.
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({ repositories: [], agents: [], providers: [], cached: true }),
  } as Response)
)

vi.mock('@/lib/layout-detection', () => ({
  shouldPreventAutoFocus: () => false,
  shouldIgnoreTouchDuringKeyboard: () => false,
  needsAggressiveKeyboardProtection: () => false,
  getFocusProtectionThreshold: () => 300,
  isMobileDevice: () => false,
}))

const mockCurrentUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: null,
  isActive: true,
  pendingEmail: null,
  emailVerificationToken: null,
  emailTokenExpiresAt: null,
  password: null,
}

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

async function renderAdmin(props: {
  list: TaskList
  canEditSettings: boolean
}) {
  const result = render(
    <ListAdminSettings
      list={props.list}
      currentUser={mockCurrentUser}
      canEditSettings={props.canEditSettings}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onEditName={vi.fn()}
      onEditImage={vi.fn()}
      onProjectBoardCreated={vi.fn()}
      onProjectBoardRemoved={vi.fn()}
    />
  )
  // Flush the mount effects (fetch repos / agents / AI providers →
  // setState) so the post-fetch updates are wrapped in act().
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

describe('ListAdminSettings — smoke render across configurations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an owner-editable plain list with the Create Board action', async () => {
    await renderAdmin({ list: makeList(), canEditSettings: true })

    expect(screen.getByText('List Name')).toBeInTheDocument()
    expect(screen.getByText('Board View')).toBeInTheDocument()
    // No projectId → Create Board, not Disable Board.
    expect(screen.getByText('Create Board')).toBeInTheDocument()
    expect(screen.queryByText('Disable Board')).not.toBeInTheDocument()
  })

  it('renders a board-attached list with the Disable Board action', async () => {
    await renderAdmin({
      list: makeList({ projectId: 'project-1' }),
      canEditSettings: true,
    })

    expect(screen.getByText('Board View')).toBeInTheDocument()
    expect(screen.getByText('Disable Board')).toBeInTheDocument()
    expect(screen.queryByText('Create Board')).not.toBeInTheDocument()
  })

  it('renders for a non-admin without the editable-only sections', async () => {
    const { container } = await renderAdmin({
      list: makeList(),
      canEditSettings: false,
    })

    // Mounted without throwing.
    expect(container).not.toBeEmptyDOMElement()
    // Board View + Delete are gated behind canEditSettings.
    expect(screen.queryByText('Board View')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete List')).not.toBeInTheDocument()
  })

  it('renders a virtual list without throwing', async () => {
    const { container } = await renderAdmin({
      list: makeList({ isVirtual: true, virtualListType: 'today' }),
      canEditSettings: true,
    })

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('List Name')).toBeInTheDocument()
  })

  it('renders a list with a GitHub repository configured', async () => {
    const { container } = await renderAdmin({
      list: makeList({ githubRepositoryId: 'repo-1' }),
      canEditSettings: true,
    })

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('List Name')).toBeInTheDocument()
  })

  it('renders a list with a recently-completed window configured', async () => {
    const { container } = await renderAdmin({
      list: makeList({
        recentlyCompletedWindow: { kind: 'duration', amount: 7, unit: 'day' },
      }),
      canEditSettings: true,
    })

    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByText('List Name')).toBeInTheDocument()
  })
})
