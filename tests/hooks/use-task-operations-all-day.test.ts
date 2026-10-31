/**
 * RED for AWTD-1433.
 *
 * useTaskOperations.createTask decided "all-day" by testing for LOCAL midnight,
 * and ignored the isAllDay the controller sends. All-day dates are stored at
 * UTC midnight, so from Los Angeles (UTC-7/8) an all-day task's date is 16:00
 * or 17:00 local and the task was saved as timed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiPost = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/lib/api', () => ({ apiPost, apiPut: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/lib/task-sounds', () => ({
  playTaskCreateSound: vi.fn(),
  playTaskCompleteSound: vi.fn(),
}))
vi.mock('@/lib/offline-sync', () => ({
  isOfflineMode: vi.fn(() => false),
  OfflineSyncManager: { queueMutation: vi.fn() },
}))
vi.mock('@/lib/offline-db', () => ({
  OfflineTaskOperations: { saveTask: vi.fn(), getTask: vi.fn(), deleteTask: vi.fn() },
  OfflineListOperations: {},
}))

import { useTaskOperations } from '@/hooks/useTaskOperations'

const originalTz = process.env.TZ

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TZ = 'America/Los_Angeles'
  apiPost.mockResolvedValue(
    new Response(JSON.stringify({ task: { id: 't1', title: 'x', completed: false } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
})

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

async function postedBody(data: Parameters<ReturnType<typeof useTaskOperations>['createTask']>[0]) {
  const { result } = renderHook(() => useTaskOperations())
  await act(async () => {
    await result.current.createTask(data)
  })
  return apiPost.mock.calls[0][1]
}

describe('createTask all-day flag (AWTD-1433)', () => {
  it('keeps an all-day task all-day when its UTC-midnight date is not local midnight', async () => {
    const body = await postedBody({
      title: 'All day',
      dueDateTime: '2026-11-05T00:00:00.000Z',
      isAllDay: true,
    })
    expect(body.isAllDay).toBe(true)
  })

  it('keeps a timed task timed even when its time is local midnight', async () => {
    const body = await postedBody({
      title: 'Timed',
      dueDateTime: new Date(2026, 10, 5, 0, 0, 0),
      isAllDay: false,
    })
    expect(body.isAllDay).toBe(false)
  })
})
