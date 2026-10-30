/**
 * AWTD-1417: opening a task while offline replaced the whole app with "List Not
 * Available".
 *
 * app/[locale]/lists/[listId]/page.tsx fetched the list again whenever the
 * `?task=` param changed, so every task opened re-asked the server. Offline, the
 * service worker answers that with a 503 (or the fetch rejects), and the page
 * swapped the working app for its error screen. The list is fetched once per
 * list, and a failure while offline keeps the app on its cached data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const search = vi.hoisted(() => ({ task: null as string | null }))
// Next's router is the same object across renders; a fresh one per call would
// re-run every effect that lists it.
const router = vi.hoisted(() => ({ replace: () => {}, push: () => {} }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ listId: 'list-1' }),
  useSearchParams: () => ({ get: (key: string) => (key === 'task' ? search.task : null) }),
  useRouter: () => router,
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, status: 'authenticated' }),
}))
vi.mock('@/components/authenticated-app', () => ({
  AuthenticatedApp: (props: { initialSelectedTaskId?: string }) => (
    <div data-testid="app">task:{props.initialSelectedTaskId ?? 'none'}</div>
  ),
}))
vi.mock('@/components/loading-screen', () => ({ LoadingScreen: () => <div data-testid="loading" /> }))

import ListsPage from '@/app/[locale]/lists/[listId]/page'

const fetchMock = vi.fn()
const online = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  search.task = null
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  online(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  online(true)
})

const ok = () => new Response(JSON.stringify({ list: { id: 'list-1', name: 'Groceries' } }), { status: 200 })

describe('lists page (AWTD-1417)', () => {
  it('fetches the list once, not again when a task opens', async () => {
    fetchMock.mockResolvedValue(ok())
    const { rerender } = render(<ListsPage />)
    await screen.findByTestId('app')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    search.task = 'task-1'
    rerender(<ListsPage />)
    await screen.findByText('task:task-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the app when the list fetch fails because the browser is offline', async () => {
    online(false)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ListsPage />)
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(screen.queryByText('List Not Available')).toBeNull()
  })

  it("keeps the app when offline and the service worker answers 503", async () => {
    online(false)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Offline' }), { status: 503 }))
    render(<ListsPage />)
    expect(await screen.findByTestId('app')).toBeInTheDocument()
  })

  it('still reports a real server failure while online', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    render(<ListsPage />)
    await waitFor(() => expect(screen.getByText('List Not Available')).toBeInTheDocument())
  })
})
