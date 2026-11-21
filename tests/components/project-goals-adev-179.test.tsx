/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-179 — a project's goals and guardrails on its board (everyone) and in its settings (owner or
 * admin). The board shows nothing when the project states nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn() }))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/client-projects', () => ({
  loadProjectsOnce: vi.fn(async () => []),
  peekLoadedProjects: vi.fn(() => []),
  subscribeLoadedProjects: vi.fn(() => () => {}),
  renameLoadedProject: vi.fn(),
}))

import { ProjectBoard } from '@/components/projects/ProjectBoard'
import { __clearProjectGoalsCache } from '@/hooks/use-project-goals'
import { withoutDraftIds } from '@/components/projects/ProjectGoalsEditor'

const STATED = {
  goals: [{ id: 'returns', statement: 'Maximise long-term returns', measure: 'IRR', target: '≥ 8%/yr', current: '6.1%' }],
  guardrails: [
    { id: 'law', statement: 'Break no applicable laws', kind: 'stated' },
    { id: 'conc', statement: 'No more than 20% in one position', kind: 'enforced' },
  ],
}

function respond(goals: unknown, canEdit = false) {
  api.apiGet.mockImplementation(async (url: string) => ({
    json: async () => (url.endsWith('/goals') ? { projectId: 'p1', ...(goals as object), canEdit } : { listIds: [] }),
  }))
}

const renderBoard = (canEditSettings = false) =>
  render(
    <ProjectBoard
      projectId="p1"
      projectName="Fund"
      canEditSettings={canEditSettings}
      lists={[]}
      allTasks={[]}
      onUpdateTask={() => {}}
      onCreateTask={async () => null}
    />,
  )

describe('ADEV-179 project goals on the board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearProjectGoalsCache()
  })

  it('shows the counts, and the goals with their measures and guardrails when opened', async () => {
    respond(STATED)
    renderBoard()
    const toggle = await screen.findByTestId('project-goals-toggle')
    expect(toggle.textContent).toContain('Goals: 1 · Guardrails: 2')
    expect(screen.queryByTestId('project-goals-detail')).toBeNull()
    fireEvent.click(toggle)
    const detail = screen.getByTestId('project-goals-detail')
    expect(detail.textContent).toContain('Maximise long-term returns')
    expect(detail.textContent).toContain('IRR · Target: ≥ 8%/yr · Now: 6.1%')
    expect(detail.textContent).toContain('No more than 20% in one position')
    expect(detail.textContent).toContain('Enforced')
  })

  it('draws nothing when the project states nothing', async () => {
    respond({ goals: [], guardrails: [] })
    renderBoard()
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledWith('/api/v1/projects/p1/goals'))
    expect(screen.queryByTestId('project-goals-strip')).toBeNull()
  })

  it('draws nothing when the read fails', async () => {
    api.apiGet.mockImplementation(async (url: string) => {
      if (url.endsWith('/goals')) throw new Error('403')
      return { json: async () => ({ listIds: [] }) }
    })
    renderBoard()
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledWith('/api/v1/projects/p1/goals'))
    expect(screen.queryByTestId('project-goals-strip')).toBeNull()
  })
})

describe('ADEV-179 project goals in settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearProjectGoalsCache()
  })

  it('loads what is stored, saves an added goal with a server id, and the board updates', async () => {
    respond(STATED, true)
    const saved = {
      goals: [...STATED.goals, { id: 'g1', statement: 'Ship weekly' }],
      guardrails: STATED.guardrails,
    }
    api.apiPut.mockResolvedValue({ json: async () => ({ projectId: 'p1', ...saved, canEdit: true }) })
    renderBoard(true)
    fireEvent.click(screen.getByTestId('project-board-settings'))
    await waitFor(() => expect(screen.getAllByTestId('project-goal-row')).toHaveLength(1))
    expect(screen.getAllByTestId('project-guardrail-row')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('project-goals-add-goal'))
    const statements = screen.getAllByLabelText('A goal, e.g. Maximise long-term returns')
    fireEvent.change(statements[1], { target: { value: 'Ship weekly' } })
    fireEvent.click(screen.getByTestId('project-settings-save'))

    await waitFor(() => expect(api.apiPut).toHaveBeenCalledTimes(1))
    const [url, body] = api.apiPut.mock.calls[0]
    expect(url).toBe('/api/v1/projects/p1/goals')
    expect(body.goals[1]).toEqual({ id: undefined, statement: 'Ship weekly' })
    expect(body.goals[0].id).toBe('returns')
    // An unchanged name is not re-sent.
    expect(api.apiPatch).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('project-settings-dialog')).toBeNull())
    expect(screen.getByTestId('project-goals-toggle').textContent).toContain('Goals: 2')
  })

  it('says so when saving fails, and keeps the dialog open', async () => {
    respond(STATED, true)
    api.apiPut.mockRejectedValue(new Error('500'))
    renderBoard(true)
    fireEvent.click(screen.getByTestId('project-board-settings'))
    await waitFor(() => expect(screen.getAllByTestId('project-goal-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('project-goals-add-guardrail'))
    fireEvent.click(screen.getByTestId('project-settings-save'))
    expect(await screen.findByText('Could not save the goals and guardrails. Try again.')).toBeTruthy()
    expect(screen.getByTestId('project-settings-dialog')).toBeTruthy()
  })

  it('withoutDraftIds keeps stored ids and drops the editor\'s', () => {
    expect(
      withoutDraftIds({ goals: [{ id: 'g-draft-1', statement: 'A' }, { id: 'keep', statement: 'B' }], guardrails: [] }),
    ).toEqual({ goals: [{ id: undefined, statement: 'A' }, { id: 'keep', statement: 'B' }], guardrails: [] })
  })
})
