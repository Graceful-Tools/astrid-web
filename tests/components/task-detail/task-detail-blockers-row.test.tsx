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
import { badgeVariants } from '@/components/ui/badge'
import type { Task } from '@/types/task'

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/lib/api', async importOriginal => ({
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  apiGet,
  apiPost,
  apiDelete: vi.fn(),
}))
const { ApiError } = await import('@/lib/api')

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

describe('TaskDetailBlockersRow without a board or a grant (AWTD-1039)', () => {
  it('sends no /blockers request for a task that is not on a board', async () => {
    const plain = { id: 'plain', title: 'Plain', statusRole: null, lists: [{ id: 'inbox' }] } as unknown as Task
    const { container } = render(
      <TaskDetailBlockersRow task={plain} availableLists={[{ id: 'inbox', name: 'Inbox' } as never]} readOnly={false} />
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(apiGet).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it('hides the row, rather than offering an Add that will be refused, when the server says not_granted', async () => {
    apiGet.mockRejectedValue(
      new ApiError('refused', 403, '/api/v1/tasks/self/blockers', { reason: 'not_granted' }, null)
    )
    const { container } = render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.innerHTML).toBe('')
  })

  it('says a refused cycle is a cycle — the reason ApiError carries in detail', async () => {
    apiPost.mockRejectedValue(
      new ApiError('conflict', 409, '/api/v1/tasks/self/blockers', { reason: 'dependency_cycle' }, null)
    )
    render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)
    await screen.findByRole('link', { name: 'Visible blocker' })

    fireEvent.click(screen.getByTestId('task-detail-add-blocker'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ta' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Neighbour' }))

    await screen.findByText('Those tasks would end up waiting for each other')
  })
})

describe('TaskDetailBlockersRow design (AWTD-1007)', () => {
  it('marks the row with an inverted triangle — a yield sign — in the muted icon column', async () => {
    render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)
    await screen.findByRole('link', { name: 'Visible blocker' })

    const icon = screen.getByTestId('waiting-on-icon')
    expect(icon.getAttribute('class')).toContain('lucide-triangle')
    expect(icon.getAttribute('class')).toContain('rotate-180')
    expect(icon.getAttribute('class')).toContain('w-4 h-4')
    expect(icon.closest('.theme-text-muted')).not.toBeNull()
  })

  it('lists a blocker the way Lists are listed — a badge carrying its short id', async () => {
    render(<TaskDetailBlockersRow task={TASK} availableLists={[]} readOnly={false} />)
    await screen.findByRole('link', { name: 'Visible blocker' })

    const chip = screen.getByTestId('task-blocker-visible')
    // The Lists row's Badge: the pill shape and the secondary fill.
    const badge = badgeVariants({ variant: 'secondary' })
    for (const cls of ['rounded-full', 'bg-secondary']) {
      expect(badge).toContain(cls)
      expect(chip.classList.contains(cls)).toBe(true)
    }
    expect(chip.textContent).toContain('AWTD-1')
    // A hidden blocker says nothing about itself — not even its id.
    expect(screen.getByTestId('task-blocker-secret').textContent).not.toContain('secret')
  })
})
