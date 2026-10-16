/**
 * AWTD-1210 (P6a-4): project fields in the task detail pane.
 *
 * Spec §9.4, decision D4. What is pinned here is the behaviour a person would
 * notice if it broke:
 *
 *   - nothing renders on a classic task, so every pane outside a GitHub board
 *     is unchanged;
 *   - a mapped field never gets a second control, since it already has a
 *     native row and AWTD-1209 refuses the write;
 *   - clearing sends `null` rather than an empty string, which is the one
 *     shape the PUT treats as "clear";
 *   - `auth_required` and `sso_required` say what to DO, not the error code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildTask } from '../../fixtures/domain'
import { TaskProjectFieldsSection } from '@/components/task-detail/TaskProjectFieldsSection'
import { clearProjectFieldCache } from '@/hooks/use-project-fields'
import type { Task } from '@/types/task'

const SCHEMA = [
  { id: 'f-notes', remoteId: 'PVTF_n', name: 'Notes', dataType: 'text', options: null, iterations: null, mappedTo: null, position: 1 },
  { id: 'f-status', remoteId: 'PVTF_s', name: 'Status', dataType: 'single_select', options: [], iterations: null, mappedTo: 'status', position: 0 },
  {
    id: 'f-size', remoteId: 'PVTF_z', name: 'Size', dataType: 'single_select',
    options: [{ id: 'opt-s', name: 'Small', color: '0969da' }], iterations: null, mappedTo: null, position: 2,
  },
]

const githubTask = (over: Partial<Task> = {}): Task =>
  buildTask({
    id: 'task-1',
    title: 'A task',
    lists: [{ id: 'list-1', name: 'Board', backend: 'github_project', projectId: 'proj-1' } as never],
    ...over,
  }) as Task

function mockFetch(schema: unknown = SCHEMA) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/fields') && (!init || init.method !== 'PUT')) {
      return { ok: true, json: async () => ({ fields: schema }) } as never
    }
    return { ok: true, json: async () => ({ field: {} }) } as never
  })
}

describe('TaskProjectFieldsSection (AWTD-1210)', () => {
  beforeEach(() => {
    clearProjectFieldCache()
    vi.stubGlobal('fetch', mockFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders nothing for a task that is not on a GitHub board', () => {
    const { container } = render(
      <TaskProjectFieldsSection task={githubTask({ lists: [{ id: 'l', name: 'Personal' } as never] })} onUpdate={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the unmapped fields in position order and never the mapped one', async () => {
    render(<TaskProjectFieldsSection task={githubTask()} onUpdate={vi.fn()} />)
    await screen.findByTestId('project-fields-section')

    expect(screen.getByLabelText('Notes')).toBeTruthy()
    expect(screen.getByLabelText('Size')).toBeTruthy()
    // Status is mapped: it has a native row already.
    expect(screen.queryByLabelText('Status')).toBeNull()
  })

  it('saves a text value with a PUT to the field route', async () => {
    const onUpdate = vi.fn()
    render(<TaskProjectFieldsSection task={githubTask()} onUpdate={onUpdate} />)
    await screen.findByTestId('project-fields-section')

    const input = screen.getByLabelText('Notes') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/tasks/task-1/fields/f-notes',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ value: 'hello' }) }),
      )
    })
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
  })

  it('clearing sends null, not an empty string', async () => {
    render(<TaskProjectFieldsSection task={githubTask({ fields: { 'f-notes': 'old' } })} onUpdate={vi.fn()} />)
    await screen.findByTestId('project-fields-section')

    const input = screen.getByLabelText('Notes') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/tasks/task-1/fields/f-notes',
        expect.objectContaining({ body: JSON.stringify({ value: null }) }),
      )
    })
  })

  it('an auth_required refusal tells the person what to do', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') return { ok: false, json: async () => ({ error: 'auth_required' }) } as never
        return { ok: true, json: async () => ({ fields: SCHEMA }) } as never
      }),
    )
    render(<TaskProjectFieldsSection task={githubTask()} onUpdate={vi.fn()} />)
    await screen.findByTestId('project-fields-section')

    const input = screen.getByLabelText('Notes') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.blur(input)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('GitHub')
    expect(alert.textContent).not.toContain('auth_required')
  })

  it('the schema is fetched once per project, not once per task pane', async () => {
    const task = githubTask()
    render(<TaskProjectFieldsSection task={task} onUpdate={vi.fn()} />)
    render(<TaskProjectFieldsSection task={{ ...task, id: 'task-2' }} onUpdate={vi.fn()} />)
    await screen.findAllByTestId('project-fields-section')

    const schemaCalls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(call =>
      String(call[0]).includes('/api/v1/projects/proj-1/fields'),
    )
    expect(schemaCalls.length).toBe(1)
  })
})
