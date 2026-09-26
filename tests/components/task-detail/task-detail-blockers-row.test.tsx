/**
 * AWTD-1002 follow-up — the "Waiting on" row in task details.
 *
 * The picker must never offer a choice the server would refuse (a task that
 * already waits on this one would close a cycle — 409), should put this
 * board's tasks first, and a blocker you can see is a way through to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskDetailBlockersRow } from '@/components/task-detail/TaskDetailBlockersRow'
import type { Task } from '@/types/task'

const apiGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ apiGet, apiPost: vi.fn(), apiDelete: vi.fn() }))

const json = (body: unknown) => ({ json: async () => body })

const TASK = {
  id: 'self',
  title: 'Self',
  statusRole: 'waiting',
  lists: [{ id: 'board', name: 'Board' }],
} as unknown as Task

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/tasks/self/blockers')) {
      return json({
        blockedBy: [
          { id: 'visible', title: 'Visible blocker', identifier: 'AWTD-1', completed: false },
          { id: 'secret', hidden: true },
        ],
        blocks: [],
        dependentIds: ['waits-on-me'],
      })
    }
    if (url.startsWith('/api/v1/search')) {
      return json({
        tasks: [
          { id: 'elsewhere', title: 'Elsewhere', lists: [{ id: 'other' }] },
          { id: 'waits-on-me', title: 'Waits on me', lists: [{ id: 'board' }] },
          { id: 'visible', title: 'Visible blocker', lists: [{ id: 'board' }] },
          { id: 'neighbour', title: 'Neighbour', lists: [{ id: 'board' }] },
          { id: 'self', title: 'Self', lists: [{ id: 'board' }] },
        ],
      })
    }
    throw new Error(`unexpected ${url}`)
  })
})

describe('TaskDetailBlockersRow (AWTD-1002)', () => {
  it('links a visible blocker to its task, and shows a hidden one without a title or link', async () => {
    render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)

    const link = await screen.findByRole('link', { name: 'Visible blocker' })
    expect(link.getAttribute('href')).toBe('/?task=visible')

    const hiddenChip = screen.getByTestId('task-blocker-secret')
    expect(hiddenChip.querySelector('a')).toBeNull()
  })

  it('never offers the task itself, a linked blocker, or one that would cycle — and ranks the board first', async () => {
    render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)
    await screen.findByRole('link', { name: 'Visible blocker' })

    fireEvent.click(screen.getByTestId('task-detail-add-blocker'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ta' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Neighbour' })).toBeTruthy())
    const offered = screen
      .getAllByRole('button')
      .map(button => button.textContent)
      .filter(text => ['Neighbour', 'Elsewhere', 'Waits on me', 'Self'].includes(text ?? ''))

    expect(offered).toEqual(['Neighbour', 'Elsewhere'])
  })
})
