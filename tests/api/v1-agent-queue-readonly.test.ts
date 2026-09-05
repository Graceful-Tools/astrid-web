import { describe, expect, it, vi } from 'vitest'

const buildAgentQueue = vi.fn().mockResolvedValue({ empty: true, queue: [] })
const reconcileAllAgentLifecycleBoards = vi.fn()
const reconcileAgentLifecycleTask = vi.fn()

vi.mock('@/lib/agent-queue', () => ({
  buildAgentQueue: (...args: unknown[]) => buildAgentQueue(...args),
  UnknownAgentError: class UnknownAgentError extends Error {
    hint = 'hint'
  },
}))

vi.mock('@/lib/agent-lifecycle', () => ({
  reconcileAllAgentLifecycleBoards: (...args: unknown[]) =>
    reconcileAllAgentLifecycleBoards(...args),
  reconcileAgentLifecycleTask: (...args: unknown[]) =>
    reconcileAgentLifecycleTask(...args),
}))

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (
    _options: unknown,
    handler: (req: Request, auth: { userId: string; source: string }) => unknown,
  ) => (req: Request) => handler(req, { userId: 'user-1', source: 'session' }),
}))

describe('GET /api/v1/agent-queue remains read-only (AWTD-760)', () => {
  it('builds the queue without invoking lifecycle reconciliation', async () => {
    const { GET } = await import('@/app/api/v1/agent-queue/route')
    const response = await GET(
      new Request('https://astrid.cc/api/v1/agent-queue?agent=copilot&listId=board-1'),
      undefined as never,
    )

    expect(response.status).toBe(200)
    expect(buildAgentQueue).toHaveBeenCalledTimes(1)
    expect(reconcileAllAgentLifecycleBoards).not.toHaveBeenCalled()
    expect(reconcileAgentLifecycleTask).not.toHaveBeenCalled()
  })
})
