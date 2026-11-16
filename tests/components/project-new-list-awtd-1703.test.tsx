/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1703 — "New list in project…" on a sidebar project row. Offered only where the core's
 * rule lets this person create (owner, admin or member), and it hands the name and project to
 * the one create-list path.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === 'project_mode' }),
}))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: { projectMode: true } }))

const projects = vi.hoisted(() => [
  { id: 'mine', name: 'Alpha', ownerId: 'me', members: [] },
  { id: 'member', name: 'Beta', ownerId: 'boss', members: [{ userId: 'me', role: 'member' }] },
  { id: 'viewer', name: 'Gamma', ownerId: 'boss', members: [{ userId: 'me', role: 'viewer' }] },
])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
}))

import { ProjectsSection } from '@/components/TaskManager/Sidebar/ProjectsSection'

function renderSection(onCreateListInProject = vi.fn()) {
  render(
    <ProjectsSection
      lists={[]}
      isMobile={false}
      selectedProjectId={null}
      selectedListId="my-tasks"
      onSelectProject={vi.fn()}
      onListClick={vi.fn()}
      getTaskCountForList={() => 0}
      currentUserId="me"
      onCreateListInProject={onCreateListInProject}
    />,
  )
  return onCreateListInProject
}

describe('New list in project (AWTD-1703)', () => {
  it('is offered on projects the person may create in, not on one they only view', async () => {
    renderSection()
    await screen.findByTestId('sidebar-project-mine')
    expect(screen.getByTestId('sidebar-project-mine-new-list')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-project-member-new-list')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-project-viewer-new-list')).toBeNull()
  })

  it('creates the named list in that project (AWTD-1703)', async () => {
    const create = renderSection()
    fireEvent.click(await screen.findByTestId('sidebar-project-member-new-list'))
    const input = screen.getByTestId('sidebar-project-member-new-list-name')
    fireEvent.change(input, { target: { value: '  Backlog  ' } })
    await act(async () => {
      fireEvent.submit(input.closest('form')!)
    })
    await waitFor(() => expect(create).toHaveBeenCalledWith('Backlog', 'member'))
    expect(screen.queryByTestId('sidebar-project-member-new-list-name')).toBeNull()
  })
})
