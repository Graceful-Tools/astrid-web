/**
 * Task e0613ae5 — `POST /api/v1/projects/from-list` must respect the Project
 * Mode gate.
 *
 * Legacy `POST /api/projects/from-list` calls `projectModeGate`. So does v1's
 * own collection route, `POST /api/v1/projects`, whose comment states the
 * principle outright:
 *
 *   // Project Mode is request-gated (task dd7172d8). Same gate as the web
 *   // route — an OAuth client must not be a way around the opt-in.
 *
 * This route creates a project too, and had no gate — so it was exactly the way
 * around the opt-in that its sibling was written to prevent. A user without the
 * feature could create a project board through v1, defeating the rollout
 * controls (OFF / ALL / PERCENTAGE / SELECTED_USERS) and the feature-access
 * request flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const projectModeGate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/project-mode', () => ({ projectModeGate }))

const createProjectFromList = vi.hoisted(() => vi.fn())
vi.mock('@/lib/projects-service', () => ({ createProjectFromList }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null), UnauthorizedError, ForbiddenError,
  }
})

import { POST } from '@/app/api/v1/projects/from-list/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const USER = 'user-1'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/v1/projects/from-list', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: USER, source: 'oauth', scopes: ['projects:write'], isAIAgent: false,
    user: { id: USER, email: 'u@example.com', name: 'U', isAIAgent: false },
  } as never)
  projectModeGate.mockResolvedValue(null) // allowed by default
  createProjectFromList.mockResolvedValue({ project: { id: 'p1' }, statusLists: [] })
})

describe('POST /api/v1/projects/from-list — Project Mode gate (task e0613ae5)', () => {
  it('refuses when Project Mode is not enabled, and creates nothing', async () => {
    projectModeGate.mockResolvedValue(
      NextResponse.json({ error: 'Project Mode is not enabled for this account' }, { status: 403 }),
    )

    const res = await POST(req({ listId: 'list-1' }) as never)

    expect(res.status).toBe(403)
    // The point of a gate: the side effect must not happen.
    expect(createProjectFromList).not.toHaveBeenCalled()
  })

  it('checks the gate against the CALLER', async () => {
    await POST(req({ listId: 'list-1' }) as never)

    expect(projectModeGate).toHaveBeenCalledWith(USER)
  })

  it('proceeds normally when Project Mode is enabled', async () => {
    const res = await POST(req({ listId: 'list-1' }) as never)

    expect(res.status).toBe(201)
    expect(createProjectFromList).toHaveBeenCalledWith(USER, 'list-1')
  })

  it('still rejects a missing listId', async () => {
    const res = await POST(req({}) as never)

    expect(res.status).toBe(400)
    expect(createProjectFromList).not.toHaveBeenCalled()
  })
})
