/**
 * Creating a task from a board column must send the column's status
 * (task f58ece7c).
 *
 * The board's add-task form resolves the column to a statusRole and the v1
 * POST persists it — but this hook rebuilt its API payload field-by-field and
 * dropped statusRole on the floor, so every task added to "Ready" landed in
 * Inbox.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskOperations } from '@/hooks/useTaskOperations'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/lib/offline-sync', () => ({
  isOfflineMode: vi.fn(() => false),
  OfflineSyncManager: { queueMutation: vi.fn() },
}))
vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: { saveTask: vi.fn(), getTask: vi.fn(), deleteTask: vi.fn() },
}))

import { apiPost } from '@/lib/api'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiPost).mockResolvedValue(
    new Response(JSON.stringify({ task: { id: 't1', title: 'New Task' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
})

describe('createTask statusRole (task f58ece7c)', () => {
  it('forwards the board column statusRole to the API', async () => {
    const { result } = renderHook(() => useTaskOperations({}))

    await act(async () => {
      await result.current.createTask({ title: 'New Task', statusRole: 'ready' })
    })

    expect(apiPost).toHaveBeenCalledWith(
      '/api/v1/tasks',
      expect.objectContaining({ statusRole: 'ready' })
    )
  })

  it('sends no statusRole when none was given (absence means Inbox)', async () => {
    const { result } = renderHook(() => useTaskOperations({}))

    await act(async () => {
      await result.current.createTask({ title: 'New Task' })
    })

    const body = vi.mocked(apiPost).mock.calls[0][1] as Record<string, unknown>
    expect(body.statusRole).toBeUndefined()
  })
})
