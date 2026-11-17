/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1660 — the Projects sidebar section and the multi-list project board.
 *
 *   - Gating: no project_mode, no Projects section (and no board); the build
 *     capability off hides it even for a granted user.
 *   - The board: one row per chosen list, × on a row header removes it and
 *     saves the new choice to the server; dropping a list from the sidebar
 *     adds it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { Task, TaskList } from '@/types/task'

const flags = vi.hoisted(() => ({ projectMode: true }))
vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === 'project_mode' && flags.projectMode }),
}))

const capabilities = vi.hoisted(() => ({ projectMode: true }))
vi.mock('@/lib/brand/capabilities', () => ({
  get CAPABILITIES() {
    return capabilities
  },
}))

const projects = vi.hoisted(() => [
  { id: 'p1', name: 'Astrid', customStates: [], lists: [{ id: 'web' }, { id: 'ios' }] },
])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  __clearLoadedProjectsCache: vi.fn(),
}))

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}))
vi.mock('@/lib/api', () => api)

vi.mock('@/components/task-detail', () => ({
  TaskDetail: ({ task, onClose }: { task: Task; onClose: () => void }) => (
    <div data-testid="inline-task-detail">{task.title}<button onClick={onClose}>close</button></div>
  ),
}))

vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: { task: Task }) => <span>{task.title}</span>,
}))

import { ProjectsSection } from '@/components/TaskManager/Sidebar/ProjectsSection'
import { ProjectBoard } from '@/components/projects/ProjectBoard'
import { PROJECT_BOARD_LIST_DRAG_TYPE } from '@/lib/project-board-rows'
import { ProjectBoardHost } from '@/components/projects/ProjectBoardHost'
import { __resetSelectedProject, setSelectedProjectId } from '@/hooks/use-selected-project'

function list(id: string, name: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    name,
    color: '#000',
    ownerId: 'u1',
    privacy: 'PRIVATE',
    listType: 'regular',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaskList
}

const lists = [
  list('web', 'Web', { projectId: 'p1' }),
  list('ios', 'iOS', { projectId: 'p1' }),
  list('groceries', 'Groceries'),
]

function task(id: string, listId: string, statusRole: string | null): Task {
  return {
    id,
    title: `Task ${id}`,
    completed: false,
    priority: 0,
    statusRole,
    lists: [lists.find(l => l.id === listId)!],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Task
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response
}

beforeEach(() => {
  flags.projectMode = true
  capabilities.projectMode = true
  api.apiGet.mockReset()
  api.apiPut.mockReset()
})

describe('Projects sidebar section gating (AWTD-1660)', () => {
  const renderSection = () => render(
    <ProjectsSection
      lists={lists}
      isMobile={false}
      selectedProjectId={null}
      selectedListId="my-tasks"
      onSelectProject={vi.fn()}
      onListClick={vi.fn()}
      getTaskCountForList={() => 0}
    />,
  )

  it('renders nothing without project_mode', async () => {
    flags.projectMode = false
    const { container } = renderSection()
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the deployment does not ship projects, even with the flag', async () => {
    capabilities.projectMode = false
    const { container } = renderSection()
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the person\'s projects, which expand to their lists', async () => {
    const onSelectProject = vi.fn()
    render(
      <ProjectsSection
        lists={lists}
        isMobile={false}
        selectedProjectId={null}
        selectedListId="my-tasks"
        onSelectProject={onSelectProject}
        onListClick={vi.fn()}
        getTaskCountForList={() => 0}
      />,
    )
    const project = await screen.findByTestId('sidebar-project-p1')
    expect(project).toHaveTextContent('Astrid')
    expect(screen.queryByTestId('sidebar-project-p1-lists')).toBeNull()

    fireEvent.click(screen.getByTestId('sidebar-project-p1-toggle'))
    const children = screen.getByTestId('sidebar-project-p1-lists')
    expect(children).toHaveTextContent('Web')
    expect(children).toHaveTextContent('iOS')
    expect(children).not.toHaveTextContent('Groceries')

    fireEvent.click(screen.getByTestId('sidebar-project-p1-open'))
    expect(onSelectProject).toHaveBeenCalledWith('p1')
  })
})

describe('ProjectBoard rows (AWTD-1660)', () => {
  const tasks = [task('a', 'web', 'doing'), task('b', 'ios', null), task('c', 'groceries', 'ready')]

  function renderBoard(
    onUpdateTask = vi.fn(),
    onCreateTask = vi.fn(async (): Promise<string | null> => null),
    onOpenTask = vi.fn(),
  ) {
    return render(
      <ProjectBoard
        projectId="p1"
        projectName="Astrid"
        lists={lists}
        allTasks={tasks}
        currentUser={{ id: 'u1' } as never}
        onUpdateTask={onUpdateTask}
        onCreateTask={onCreateTask}
        onOpenTask={onOpenTask}
      />,
    )
  }

  it('shows the project\'s lists as rows by default, with the board columns', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: null }))
    renderBoard()
    expect(await screen.findByTestId('project-board-row-web')).toHaveTextContent('Task a')
    expect(screen.getByTestId('project-board-row-ios')).toHaveTextContent('Task b')
    expect(screen.queryByTestId('project-board-row-groceries')).toBeNull()
    expect(screen.getByTestId('project-board-cell-web-doing')).toHaveTextContent('Task a')
    expect(screen.getByTestId('project-board-cell-ios-__virtual_inbox__')).toHaveTextContent('Task b')
  })

  it('AWTD-1675: a cell\'s add box creates the card in that row\'s list and that column\'s status', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: ['web', 'ios'] }))
    const onCreateTask = vi.fn(async (): Promise<string | null> => 'new')
    renderBoard(vi.fn(), onCreateTask)
    await screen.findByTestId('project-board-row-ios')

    fireEvent.change(screen.getByTestId('project-board-add-input-ios-doing'), { target: { value: 'Ship it' } })
    fireEvent.submit(screen.getByTestId('project-board-add-input-ios-doing').closest('form')!)

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith('Ship it', { listIds: ['ios'], statusRole: 'doing' }))
    expect(screen.queryByTestId('project-board-add-input-ios-done')).toBeNull()
  })

  it('× on a row header removes the row and saves the choice on the server', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: ['web', 'ios'] }))
    api.apiPut.mockResolvedValue(jsonResponse({ listIds: ['ios'] }))
    renderBoard()
    await screen.findByTestId('project-board-row-web')

    fireEvent.click(screen.getByTestId('project-board-remove-web'))

    await waitFor(() => expect(screen.queryByTestId('project-board-row-web')).toBeNull())
    expect(api.apiPut).toHaveBeenCalledWith('/api/v1/projects/p1/board-rows', { listIds: ['ios'] })
  })

  it('dropping a list from the sidebar adds it as a row and saves', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: ['web'] }))
    api.apiPut.mockResolvedValue(jsonResponse({ listIds: ['web', 'groceries'] }))
    renderBoard()
    await screen.findByTestId('project-board-row-web')

    const dataTransfer = {
      types: [PROJECT_BOARD_LIST_DRAG_TYPE],
      getData: (type: string) => (type === PROJECT_BOARD_LIST_DRAG_TYPE ? 'groceries' : ''),
      dropEffect: 'none',
    }
    const board = screen.getByTestId('project-board')
    fireEvent.dragOver(board, { dataTransfer })
    fireEvent.drop(board, { dataTransfer })

    expect(await screen.findByTestId('project-board-row-groceries')).toHaveTextContent('Task c')
    expect(api.apiPut).toHaveBeenCalledWith('/api/v1/projects/p1/board-rows', { listIds: ['web', 'groceries'] })
  })

  it('dragging a card to another column sets its status, as on the list board', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: null }))
    const onUpdateTask = vi.fn()
    renderBoard(onUpdateTask)
    await screen.findByTestId('project-board-row-web')
    const dataTransfer = { types: ['text/plain'], getData: () => 'a' }
    fireEvent.drop(screen.getByTestId('project-board-cell-web-waiting'), { dataTransfer })
    expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', statusRole: 'waiting', completed: false }))
  })

  it('AITD-679: a card opens its details like a list row, anchored to the card, never in place', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: null }))
    const onOpenTask = vi.fn()
    renderBoard(undefined, undefined, onOpenTask)
    const card = (await screen.findByText('Task a')).closest('[data-task-id]') as HTMLElement
    expect(card).toHaveAttribute('data-task-id', 'a')
    fireEvent.click(card)
    expect(onOpenTask).toHaveBeenCalledWith('a', card)
    expect(screen.queryByTestId('inline-task-detail')).toBeNull()
  })

  it('puts the row back if the save fails', async () => {
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: ['web', 'ios'] }))
    api.apiPut.mockRejectedValue(new Error('offline'))
    renderBoard()
    await screen.findByTestId('project-board-row-web')
    fireEvent.click(screen.getByTestId('project-board-remove-web'))
    expect(await screen.findByTestId('project-board-row-web')).toBeTruthy()
  })
})

describe('ProjectBoardHost gating (AWTD-1660)', () => {
  beforeEach(() => {
    __resetSelectedProject()
    api.apiGet.mockResolvedValue(jsonResponse({ listIds: null }))
  })
  const renderHost = () => render(
    <ProjectBoardHost lists={lists} tasks={[]} onUpdateTask={vi.fn()} onCreateTask={vi.fn(async () => null)} />,
  )

  it('draws the selected project\'s board for someone with project_mode', async () => {
    setSelectedProjectId('p1')
    renderHost()
    expect(await screen.findByTestId('project-board')).toHaveTextContent('Astrid')
  })

  it('without project_mode it draws nothing and closes the selection', async () => {
    flags.projectMode = false
    setSelectedProjectId('p1')
    const { container } = renderHost()
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
    const { useSelectedProjectId } = await import('@/hooks/use-selected-project')
    let seen: string | null = 'unset'
    function Probe() { seen = useSelectedProjectId(); return null }
    render(<Probe />)
    expect(seen).toBeNull()
  })

  it('a project that is not one of theirs closes the selection', async () => {
    setSelectedProjectId('someone-elses')
    const { container } = renderHost()
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })
})
