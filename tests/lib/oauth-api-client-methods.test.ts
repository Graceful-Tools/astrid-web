/**
 * Task cde681e4 — the OAuth client library hit the same 405 as the reminder
 * notification.
 *
 * `updateTask` sent PATCH to `/api/v1/tasks/[id]`, which exports only GET, PUT
 * and DELETE. Every update through this client returned 405 and surfaced as
 * `{ success: false }` with an opaque message — and because the failure is a
 * routing mismatch rather than a validation error, nothing in the body would
 * have hinted at the cause.
 *
 * Asserting the method here rather than the outcome: the endpoint that gets
 * called IS the bug, and a test on `success` alone would pass again the moment
 * someone mocked the fetch differently.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env.ASTRID_OAUTH_CLIENT_ID = 'client'
  process.env.ASTRID_OAUTH_CLIENT_SECRET = 'secret'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

/** Token exchange first, then the actual call — this returns both. */
function mockFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      } as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ task: { id: 'task-1', title: 'x' } }),
    } as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('OAuth API client task update (task cde681e4)', () => {
  it('updates with a method /api/v1/tasks/[id] implements', async () => {
    const fetchMock = mockFetch()
    const { OAuthAPIClient } = await import('@/lib/oauth-api-client')

    await new OAuthAPIClient().updateTask('task-1', { completed: true })

    const taskCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/tasks/'))
    expect(taskCall).toBeDefined()
    const init = taskCall![1] as RequestInit
    // PATCH is a 405 on this route: it exports GET, PUT and DELETE only.
    expect(init.method).not.toBe('PATCH')
    expect(init.method).toBe('PUT')
  })

  it('still sends a partial body, which v1 PUT accepts', async () => {
    // The reason PUT is safe here: v1 applies only the fields present, so a
    // one-field update does not need to resend the whole task.
    const fetchMock = mockFetch()
    const { OAuthAPIClient } = await import('@/lib/oauth-api-client')

    await new OAuthAPIClient().updateTask('task-1', { completed: true })

    const taskCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/tasks/'))
    expect(JSON.parse(String((taskCall![1] as RequestInit).body))).toEqual({ completed: true })
  })
})
