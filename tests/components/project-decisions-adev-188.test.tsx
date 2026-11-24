/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-188 (UI half of ADEV-180): on a project's board, "New decision" starts a decision from the
 * project's goals (POST …/decisions) and opens the new task; the Decisions view lists the open and
 * decided ones from GET …/decisions, with the choice, and records a choice through POST …/decide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => []),
  peekLoadedProjects: vi.fn(() => []),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  renameLoadedProject: vi.fn(),
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'
import { __clearProjectDecisionsCache } from '@/hooks/use-project-decisions'
import { __clearProjectGoalsCache } from '@/hooks/use-project-goals'

const DECISIONS = [
  {
    id: 't-open', identifier: 'FUND-7', title: 'Where to hold the offsite', prompt: 'Where?',
    options: [{ number: 1, text: 'Lisbon', recommended: true }, { number: 2, text: 'Cabin', recommended: false }],
    status: 'open', chosen: null, assigneeId: null, createdAt: '2026-11-24T10:00:00.000Z',
  },
  {
    id: 't-done', identifier: 'FUND-3', title: 'Which broker', prompt: 'Which broker?',
    options: [{ number: 1, text: 'Alpha', recommended: false }, { number: 2, text: 'Beta', recommended: true }],
    status: 'decided', chosen: { number: 2, text: 'Beta' }, assigneeId: null, createdAt: '2026-11-20T10:00:00.000Z',
  },
]

function respond(decisions: unknown[] = DECISIONS) {
  api.apiGet.mockImplementation(async (url: string) => ({
    json: async () => {
      if (url.endsWith('/decisions')) return { projectId: 'p1', decisions }
      if (url.endsWith('/goals')) return { projectId: 'p1', goals: [], guardrails: [], canEdit: false }
      return { listIds: [] }
    },
  }))
  api.apiPost.mockImplementation(async (url: string) => ({
    json: async () => (url.endsWith('/decide') ? { chosen: { number: 1, text: 'Lisbon' } } : { task: { id: 't-new', identifier: 'FUND-8', title: 'Decision', listIds: ['l1'] }, criteria: [] }),
  }))
}

const renderBoard = (onOpenTask = vi.fn()) => {
  render(
    <ProjectBoard
      projectId="p1"
      projectName="Fund"
      lists={[]}
      allTasks={[]}
      onUpdateTask={() => {}}
      onCreateTask={async () => null}
      onOpenTask={onOpenTask}
    />,
  )
  return onOpenTask
}

describe('ADEV-188 project decisions on the board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearProjectDecisionsCache()
    __clearProjectGoalsCache()
  })

  it('New decision starts one from the goals and opens the new task', async () => {
    respond([])
    const onOpenTask = renderBoard()
    fireEvent.click(await screen.findByTestId('project-new-decision'))
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('t-new'))
    expect(api.apiPost).toHaveBeenCalledWith('/api/v1/projects/p1/decisions', {})
  })

  it('counts the open decisions and lists open and decided ones with the choice', async () => {
    respond()
    renderBoard()
    const toggle = await screen.findByTestId('project-decisions-toggle')
    await waitFor(() => expect(toggle.textContent).toContain('1'))
    fireEvent.click(toggle)
    const open = await screen.findByTestId('project-decisions-open')
    expect(open.textContent).toContain('FUND-7')
    expect(open.textContent).toContain('Where to hold the offsite')
    const decided = screen.getByTestId('project-decisions-decided')
    expect(decided.textContent).toContain('Which broker')
    expect(decided.textContent).toContain('2 — Beta')
  })

  it('records a choice after a confirmation', async () => {
    respond()
    renderBoard()
    fireEvent.click(await screen.findByTestId('project-decisions-toggle'))
    const open = await screen.findByTestId('project-decisions-open')
    fireEvent.click(within(open).getByTestId('project-decision-choose-t-open-1'))
    expect(api.apiPost).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId('project-decision-confirm-confirm'))
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/api/v1/projects/p1/decisions/t-open/decide', { option: 1 }))
  })

  it('opens a decision task from the list', async () => {
    respond()
    const onOpenTask = renderBoard()
    fireEvent.click(await screen.findByTestId('project-decisions-toggle'))
    fireEvent.click(await screen.findByTestId('project-decision-open-t-done'))
    expect(onOpenTask).toHaveBeenCalledWith('t-done')
  })
})
