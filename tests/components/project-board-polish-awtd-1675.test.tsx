/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1675 — project board polish.
 *
 *   - The header names the open project, not the list last selected beneath it.
 *   - Any list selection (palette, shortcut — not only a sidebar click) closes
 *     the project board.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'

vi.mock('@/hooks/useMyTasksPreferences', () => ({
  useMyTasksPreferences: () => ({
    filters: { priority: [], assignee: [], dueDate: 'all', completion: 'default', sortBy: 'auto', manualSortOrder: [] },
    setters: {},
    hasActiveFilters: false,
    clearAllFilters: vi.fn(),
    isLoading: false,
  }),
}))

const projects = vi.hoisted(() => [{ id: 'p1', name: 'Astrid Project', customStates: [], lists: [] }])
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => projects),
  peekLoadedProjects: vi.fn(() => projects),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  __clearLoadedProjectsCache: vi.fn(),
}))

import { TaskManagerHeader } from '@/components/TaskManager/Header/TaskManagerHeader'
import { useTaskNavigation } from '@/hooks/task-manager/useTaskNavigation'
import {
  __resetSelectedProject,
  setSelectedProjectId,
  useSelectedProjectId,
} from '@/hooks/use-selected-project'
import { buildTaskList } from '../fixtures/domain'

const list = buildTaskList({ id: 'web', name: 'Web To-do', ownerId: 'user1', imageUrl: null })

const headerProps = {
  isMobile: true,
  showHamburgerMenu: true,
  mobileView: 'list' as const,
  lists: [list],
  selectedListId: 'web',
  selectedTask: null,
  effectiveSession: { user: { id: 'user1', email: 'a@b.c', name: 'A' }, expires: '2999-01-01' },
  mobileSearchMode: false,
  searchValue: '',
  toggleMobileSidebar: () => {},
  handleMobileBack: () => {},
  onLogoClick: () => {},
  handleMobileSearchStart: () => {},
  handleMobileSearchEnd: () => {},
  handleMobileSearchClear: () => {},
  handleMobileSearchKeyDown: () => {},
  onSearchChange: () => {},
  setShowSettingsPopover: () => {},
  onShowKeyboardShortcuts: () => {},
  isTaskDragActive: false,
  onHamburgerDragHover: () => {},
}

beforeEach(() => {
  __resetSelectedProject()
  window.history.replaceState(null, '', '/')
})

describe('AWTD-1675 project board polish', () => {
  it('AWTD-1675: the header shows the project name while a board is open', () => {
    setSelectedProjectId('p1')
    render(<TaskManagerHeader {...headerProps} />)
    expect(screen.getByText('Astrid Project')).toBeInTheDocument()
    expect(screen.queryByText('Web To-do')).toBeNull()
  })

  it('AWTD-1675: the header shows the list name when no board is open', () => {
    render(<TaskManagerHeader {...headerProps} />)
    expect(screen.getByText('Web To-do')).toBeInTheDocument()
  })

  it('AWTD-1675: selecting a list by any route closes the open project board', () => {
    setSelectedProjectId('p1')
    const { result } = renderHook(() => ({
      nav: useTaskNavigation({
        initialSelectedListId: 'web',
        isMobile: false,
        loading: false,
        tasks: [],
        selectedTaskId: '',
        setSelectedTaskId: () => {},
      }),
      project: useSelectedProjectId(),
    }))
    expect(result.current.project).toBe('p1')
    act(() => result.current.nav.setSelectedListId('ios'))
    expect(result.current.project).toBeNull()
    expect(window.location.search).toBe('')
  })
})
