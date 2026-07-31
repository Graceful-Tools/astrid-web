/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the Project Status Board feature
 * out of the 1322-line components/list-admin-settings.tsx into
 * components/list-admin/BoardViewSection.tsx.
 *
 * These pin the extracted component's behaviour: gating on
 * canEditSettings, the Create vs Disable Board action, and the disable
 * confirmation modal open/close.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TaskList } from '@/types/task'

// Project Mode is request-gated (task dd7172d8): the board controls only render
// for a user who has been granted the feature. Default to granted so the
// pre-existing cases below keep testing what they were written to test.
const projectModeGranted = vi.hoisted(() => ({ value: true }))
vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => projectModeGranted.value }),
}))

import { BoardViewSection } from '@/components/list-admin/BoardViewSection'

global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
)

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

function renderSection(props: {
  list: TaskList
  canEditSettings: boolean
}) {
  return render(
    <BoardViewSection
      list={props.list}
      canEditSettings={props.canEditSettings}
      onUpdate={vi.fn()}
      onProjectBoardCreated={vi.fn()}
      onProjectBoardRemoved={vi.fn()}
    />
  )
}

describe('BoardViewSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectModeGranted.value = true
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = renderSection({
      list: makeList(),
      canEditSettings: false,
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the Create Board action for a list with no board', () => {
    renderSection({ list: makeList(), canEditSettings: true })

    expect(screen.getByText('Board View')).toBeInTheDocument()
    expect(screen.getByText('Create Board')).toBeInTheDocument()
    expect(screen.queryByText('Disable Board')).not.toBeInTheDocument()
  })

  it('shows the Disable Board action for a board-attached list', () => {
    renderSection({
      list: makeList({ projectId: 'project-1' }),
      canEditSettings: true,
    })

    expect(screen.getByText('Disable Board')).toBeInTheDocument()
    expect(screen.queryByText('Create Board')).not.toBeInTheDocument()
  })

  it('opens the disable-board confirmation modal when Disable Board is clicked', () => {
    renderSection({
      list: makeList({ projectId: 'project-1' }),
      canEditSettings: true,
    })

    expect(screen.queryByText('Disable Board View')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Disable Board'))
    expect(screen.getByText('Disable Board View')).toBeInTheDocument()
  })

  it('closes the confirmation modal when Cancel is clicked', () => {
    renderSection({
      list: makeList({ projectId: 'project-1' }),
      canEditSettings: true,
    })

    fireEvent.click(screen.getByText('Disable Board'))
    expect(screen.getByText('Disable Board View')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Disable Board View')).not.toBeInTheDocument()
  })

  describe('request gating (dd7172d8)', () => {
    it('offers Request access instead of Create Board when the user has not been granted it', () => {
      projectModeGranted.value = false
      renderSection({ list: makeList(), canEditSettings: true })

      expect(screen.getByText('Request access')).toBeInTheDocument()
      expect(screen.queryByText('Create Board')).not.toBeInTheDocument()
    })

    it('keeps board controls for a list that already has a board, even without the grant', () => {
      // We never strand someone inside a feature they are already using: an
      // existing board keeps working if the grant is later revoked.
      projectModeGranted.value = false
      renderSection({ list: makeList({ projectId: 'project-1' }), canEditSettings: true })

      expect(screen.getByText('Disable Board')).toBeInTheDocument()
      expect(screen.queryByText('Request access')).not.toBeInTheDocument()
    })

    it('opens the request dialog and posts the request', async () => {
      projectModeGranted.value = false
      const fetchMock = vi.mocked(global.fetch)
      renderSection({ list: makeList(), canEditSettings: true })

      fireEvent.click(screen.getByText('Request access'))
      expect(screen.getByText('Request board access')).toBeInTheDocument()

      fetchMock.mockClear()
      fireEvent.click(screen.getByText('Send request'))

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/feature-requests',
          expect.objectContaining({ method: 'POST' })
        )
      })
    })
  })
})
