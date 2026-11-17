/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-61 — the sidebar draws each project as its own section, matching iOS (ADEV-47/57):
 *
 *   - No umbrella "Projects" heading. Each project is a section headed by its name, its lists
 *     the section's own rows, shown until hidden by the header's chevron, remembered per browser.
 *   - Right-click (or long-press) a project header: New List in Project…, and for its owner
 *     Delete Project… behind a confirm step.
 *   - Right-click (or long-press) a list row: Move to Project ▸ and Remove from Project, from
 *     the core's `listProjectMoves`.
 *   - Drop a sidebar list on a project header to move it there.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { TaskList } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === 'project_mode' }),
}))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: { projectMode: true } }))

const projects = vi.hoisted(() => [
  { id: 'alpha', name: 'Alpha', ownerId: 'me', members: [] },
  { id: 'beta', name: 'Beta', ownerId: 'boss', members: [{ userId: 'me', role: 'admin' }] },
  { id: 'gamma', name: 'Gamma', ownerId: 'boss', members: [{ userId: 'me', role: 'viewer' }] },
])
const removed = vi.hoisted(() => [] as string[])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  removeLoadedProject: vi.fn((id: string) => removed.push(id)),
}))
const api = vi.hoisted(() => ({
  apiCall: vi.fn(),
  refusalReason: vi.fn(() => null),
}))
vi.mock('@/lib/api', () => api)

import { ProjectsSection } from '@/components/TaskManager/Sidebar/ProjectsSection'
import { ListProjectMenu } from '@/components/TaskManager/Sidebar/ListProjectMenu'
import { PROJECT_BOARD_LIST_DRAG_TYPE } from '@/lib/project-board-list-drag'

beforeAll(() => {
  // Radix's popper measures its anchor; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const list = (id: string, name: string, projectId: string | null): TaskList =>
  ({ id, name, projectId, ownerId: 'me', listMembers: [], privacy: 'PRIVATE' }) as unknown as TaskList

const lists = [list('web', 'Web', 'alpha'), list('ios', 'iOS', 'alpha'), list('home', 'Home', null)]

function renderSection(overrides: Partial<React.ComponentProps<typeof ProjectsSection>> = {}) {
  const props = {
    lists,
    isMobile: false,
    selectedProjectId: null,
    selectedListId: 'my-tasks',
    onSelectProject: vi.fn(),
    onListClick: vi.fn(),
    getTaskCountForList: () => 0,
    currentUserId: 'me',
    onCreateListInProject: vi.fn(),
    onMoveListToProject: vi.fn(),
    onProjectDeleted: vi.fn(),
    ...overrides,
  }
  render(<ProjectsSection {...props} />)
  return props
}

beforeEach(() => {
  window.localStorage.clear()
  removed.length = 0
  api.apiCall.mockReset()
})

describe('each project is its own section (ADEV-61)', () => {
  it('has no umbrella Projects heading and no folder icon; the header is the project name', async () => {
    renderSection()
    const header = await screen.findByTestId('sidebar-project-alpha-header')
    expect(header).toHaveTextContent('Alpha')
    expect(screen.queryByText('Projects')).toBeNull()
    expect(screen.queryByTestId('sidebar-project-alpha-folder-icon')).toBeNull()
  })

  it('shows its lists by default, as the section\'s own rows', async () => {
    renderSection()
    const rows = await screen.findByTestId('sidebar-project-alpha-lists')
    expect(rows).toHaveTextContent('Web')
    expect(rows).toHaveTextContent('iOS')
    expect(rows).not.toHaveTextContent('Home')
    expect(rows.className).not.toMatch(/\bml-\d/)
  })

  it('hides and shows them with the header\'s trailing chevron, and remembers the choice', async () => {
    renderSection()
    const toggle = await screen.findByTestId('sidebar-project-alpha-toggle')
    expect(toggle).toHaveAttribute('aria-label', 'Hide lists in Alpha')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(screen.queryByTestId('sidebar-project-alpha-lists')).toBeNull()
    expect(toggle).toHaveAttribute('aria-label', 'Show lists in Alpha')

    // A fresh mount (a reload) keeps it hidden; another project is untouched.
    document.body.innerHTML = ''
    renderSection()
    await screen.findByTestId('sidebar-project-alpha-header')
    expect(screen.queryByTestId('sidebar-project-alpha-lists')).toBeNull()
    expect(screen.getByTestId('sidebar-project-beta-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('still opens the project board from its name', async () => {
    const props = renderSection()
    fireEvent.click(await screen.findByTestId('sidebar-project-alpha-open'))
    expect(props.onSelectProject).toHaveBeenCalledWith('alpha')
  })
})

describe('the project header menu (ADEV-61)', () => {
  it('right-click offers New List in Project… where the person may create, and Delete Project… only to the owner', async () => {
    renderSection()
    fireEvent.contextMenu(await screen.findByTestId('sidebar-project-alpha-header'))
    let menu = await screen.findByRole('menu')
    expect(within(menu).getByText('New list in project…')).toBeInTheDocument()
    expect(within(menu).getByText('Delete Project…')).toBeInTheDocument()
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    // An admin may create but not delete.
    fireEvent.contextMenu(screen.getByTestId('sidebar-project-beta-header'))
    menu = await screen.findByRole('menu')
    expect(within(menu).getByText('New list in project…')).toBeInTheDocument()
    expect(within(menu).queryByText('Delete Project…')).toBeNull()
  })

  it('offers no menu on a project where the person can do neither', async () => {
    renderSection()
    fireEvent.contextMenu(await screen.findByTestId('sidebar-project-gamma-header'))
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('New List in Project… opens the name field for that project', async () => {
    const props = renderSection()
    fireEvent.contextMenu(await screen.findByTestId('sidebar-project-beta-header'))
    fireEvent.click(await screen.findByText('New list in project…'))
    const input = await screen.findByTestId('sidebar-project-beta-new-list-name')
    fireEvent.change(input, { target: { value: 'Backlog' } })
    await act(async () => {
      fireEvent.submit(input.closest('form')!)
    })
    expect(props.onCreateListInProject).toHaveBeenCalledWith('Backlog', 'beta')
  })

  it('Delete Project… asks first, then deletes and reports the detached lists', async () => {
    api.apiCall.mockResolvedValue({ json: async () => ({ success: true, detachedListIds: ['web', 'ios'] }) })
    const props = renderSection()
    fireEvent.contextMenu(await screen.findByTestId('sidebar-project-alpha-header'))
    fireEvent.click(await screen.findByText('Delete Project…'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete Alpha?')
    expect(api.apiCall).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('sidebar-project-delete-confirm'))
    })
    expect(api.apiCall).toHaveBeenCalledWith('/api/v1/projects/alpha', { method: 'DELETE' })
    expect(removed).toEqual(['alpha'])
    expect(props.onProjectDeleted).toHaveBeenCalledWith('alpha', ['web', 'ios'])
  })

  it('long-press opens the same menu on touch', async () => {
    vi.useFakeTimers()
    try {
      renderSection()
      await act(async () => {})
      const header = screen.getByTestId('sidebar-project-alpha-header')
      fireEvent.pointerDown(header, { pointerType: 'touch', clientX: 10, clientY: 10 })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(screen.getByRole('menu')).toHaveTextContent('Delete Project…')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('dropping a list on a project header (ADEV-61)', () => {
  const drop = (target: HTMLElement, listId: string) => {
    const dataTransfer = {
      types: [PROJECT_BOARD_LIST_DRAG_TYPE],
      getData: (type: string) => (type === PROJECT_BOARD_LIST_DRAG_TYPE ? listId : ''),
      dropEffect: 'none',
    }
    fireEvent.dragOver(target, { dataTransfer })
    fireEvent.drop(target, { dataTransfer })
  }

  it('moves the list into that project when the core allows it', async () => {
    const props = renderSection()
    drop(await screen.findByTestId('sidebar-project-beta-header'), 'home')
    expect(props.onMoveListToProject).toHaveBeenCalledWith('home', 'beta')
  })

  it('ignores a drop the core refuses: a viewer\'s project, or the list\'s own project', async () => {
    const props = renderSection()
    drop(await screen.findByTestId('sidebar-project-gamma-header'), 'home')
    drop(screen.getByTestId('sidebar-project-alpha-header'), 'web')
    expect(props.onMoveListToProject).not.toHaveBeenCalled()
  })
})

describe('the list row menu (ADEV-61)', () => {
  function renderRow(target: TaskList, onMove = vi.fn()) {
    render(
      <ListProjectMenu list={target} currentUserId="me" onMoveListToProject={onMove}>
        <button data-testid="row">{target.name}</button>
      </ListProjectMenu>,
    )
    return onMove
  }

  it('Move to Project ▸ lists the projects the core allows and moves the list', async () => {
    const onMove = renderRow(list('home', 'Home', null))
    await act(async () => {})
    fireEvent.contextMenu(screen.getByTestId('row'))
    fireEvent.click(await screen.findByText('Move to Project'))
    const alpha = await screen.findByRole('menuitem', { name: 'Alpha' })
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Gamma' })).toBeNull()
    fireEvent.click(alpha)
    expect(onMove).toHaveBeenCalledWith('home', 'alpha')
  })

  it('Remove from Project asks first, then takes the list out', async () => {
    const onMove = renderRow(list('web', 'Web', 'alpha'))
    await act(async () => {})
    fireEvent.contextMenu(screen.getByTestId('row'))
    fireEvent.click(await screen.findByText('Remove from Project'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove Web from Alpha?')
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByTestId('sidebar-list-leave-confirm'))
    expect(onMove).toHaveBeenCalledWith('web', null)
  })

  it('leaves the row alone when there is nowhere to move it', async () => {
    const theirs = { ...list('x', 'Theirs', null), ownerId: 'someone' } as TaskList
    renderRow(theirs)
    await act(async () => {})
    fireEvent.contextMenu(screen.getByTestId('row'))
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
