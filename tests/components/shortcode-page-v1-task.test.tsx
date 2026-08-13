/**
 * @vitest-environment jsdom
 */

/**
 * Task 92e582c6 — the share-code landing page reads the task from v1.
 *
 * Two things had to be true before this page could move off `/api/tasks/[id]`:
 * v1 had to stop 403ing signed-in non-members on PUBLIC lists (the point of
 * the task), and the page had to unwrap v1's `{ task, meta }` envelope.
 *
 * The second one fails silently. Reading `body.lists` off the envelope yields
 * undefined for every task, the "task has no lists" fallback fires, and every
 * share link lands on My Tasks instead of the list it points at — no error, no
 * 4xx, just the wrong page. So the assertion here is the destination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const replace = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'abc123' }),
  useRouter: () => ({ replace, push }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }),
}))

vi.mock('@/components/loading-screen', () => ({
  LoadingScreen: () => <div>loading</div>,
}))

import ShortcodePage from '@/app/[locale]/s/[code]/page'

function mockFetch(taskBody: unknown) {
  return vi.fn(async (url: string) => {
    if (url.includes('/api/v1/shortcodes/')) {
      return { ok: true, status: 200, json: async () => ({ targetType: 'task', targetId: 'task-1' }) }
    }
    if (url === '/api/v1/tasks/task-1') {
      return { ok: true, status: 200, json: async () => taskBody }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('share-code page → v1 single task (task 92e582c6)', () => {
  it('navigates to the task inside its list, unwrapping the v1 envelope', async () => {
    global.fetch = mockFetch({
      task: { id: 'task-1', lists: [{ id: 'list-1' }] },
      meta: { apiVersion: 'v1' },
    }) as never

    render(<ShortcodePage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/lists/list-1?task=task-1')
    })
  })

  it('falls back to My Tasks only when the task genuinely has no lists', async () => {
    global.fetch = mockFetch({ task: { id: 'task-1', lists: [] }, meta: {} }) as never

    render(<ShortcodePage />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/?task=task-1')
    })
  })

  it('asks v1 rather than the legacy route', async () => {
    const fetchMock = mockFetch({ task: { id: 'task-1', lists: [{ id: 'list-1' }] }, meta: {} })
    global.fetch = fetchMock as never

    render(<ShortcodePage />)

    await waitFor(() => expect(replace).toHaveBeenCalled())
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('/api/v1/tasks/task-1')
    expect(urls.some((u) => u === '/api/tasks/task-1')).toBe(false)
  })
})
