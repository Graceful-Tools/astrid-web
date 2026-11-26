/**
 * Shared harness for `/api/v1` route tests (ADEV-300).
 *
 * Route tests used to rebuild the same scaffolding file by file: a hand-written
 * `vi.mock('@/lib/api-auth-middleware', …)`, a `NextRequest`, a params promise and
 * a `.json()` call. This holds that once. `tests/setup.ts` already mocks
 * `@/lib/prisma`, so Prisma needs no mock here; seed rows on `mockPrisma`.
 *
 * Usage:
 *
 *   import { GET, POST } from '@/app/api/v1/tasks/[id]/comments/route'
 *   import { mockPrisma } from '../setup'
 *   import {
 *     authMiddlewareMock, resetRouteHarness, signIn, signOut, callRoute, taskOnList,
 *   } from '../utils/route-harness'
 *
 *   // vi.mock is hoisted, so it must be written in the test file itself.
 *   vi.mock('@/lib/api-auth-middleware', async () =>
 *     (await import('../utils/route-harness')).authMiddlewareMock())
 *
 *   beforeEach(() => resetRouteHarness())
 *
 *   it('lists comments', async () => {
 *     signIn({ userId: 'user-1', scopes: ['comments:read'] })
 *     mockPrisma.task.findUnique.mockResolvedValue(taskOnList({ creatorId: 'user-1' }))
 *     const { status, body } = await callRoute(GET, { path: '/api/v1/tasks/task-1/comments', id: 'task-1' })
 *     expect(status).toBe(200)
 *   })
 */

import { vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'

const authenticateAPI = vi.fn()
const requireScopes = vi.fn()
const getDeprecationWarning = vi.fn()
// Throw on denial; resolving means access granted. Tests about authorization
// override these.
const requireTaskAccess = vi.fn()
const requireTaskReadAccess = vi.fn()

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}
class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** The module `vi.mock('@/lib/api-auth-middleware', …)` should return. */
export function authMiddlewareMock() {
  return {
    authenticateAPI,
    requireScopes,
    getDeprecationWarning,
    requireTaskAccess,
    requireTaskReadAccess,
    UnauthorizedError,
    ForbiddenError,
  }
}

/** Clear every mock and put auth back to "no one is signed in, no deprecation". Call from `beforeEach`. */
export function resetRouteHarness(): void {
  vi.clearAllMocks()
  requireScopes.mockImplementation(() => {})
  getDeprecationWarning.mockReturnValue(null)
  requireTaskAccess.mockResolvedValue(undefined)
  requireTaskReadAccess.mockResolvedValue(undefined)
  signOut()
}

/**
 * Drop Prisma models from the global mock. `job` is the usual one: without it,
 * `enqueueJob` runs its handler after the response, which `flushAfterResponse`
 * (tests/utils/after-response.ts) can then await.
 */
export function removePrismaModels(...models: string[]): void {
  for (const model of models) delete (mockPrisma as any)[model]
}

/**
 * Add Prisma models the global mock (`tests/setup.ts`) lacks, each method a bare
 * `vi.fn()`. Call from `beforeEach` after `resetRouteHarness()`.
 */
export function ensurePrismaModels(models: Record<string, string[]>): void {
  for (const [model, methods] of Object.entries(models)) {
    ;(mockPrisma as any)[model] = Object.fromEntries(methods.map(m => [m, vi.fn()]))
  }
}

export interface SignInOptions {
  userId?: string
  scopes?: string[]
  source?: string
  isAIAgent?: boolean
  /** Extra AuthContext fields (e.g. `agentUser` for an agent-bound MCP token). */
  extra?: Record<string, unknown>
}

/** Authenticate the next request as this user. */
export function signIn(options: SignInOptions = {}): void {
  const userId = options.userId ?? 'user-1'
  authenticateAPI.mockResolvedValue({
    userId,
    source: options.source ?? 'oauth',
    scopes: options.scopes ?? [],
    isAIAgent: options.isAIAgent ?? false,
    user: { id: userId, email: `${userId}@example.com`, name: userId, isAIAgent: options.isAIAgent ?? false },
    ...options.extra,
  })
}

/** The next request is unauthenticated: `authenticateAPI` rejects with UnauthorizedError. */
export function signOut(): void {
  authenticateAPI.mockRejectedValue(new UnauthorizedError())
}

export interface CallRouteOptions {
  /** Request path, e.g. `/api/v1/tasks/task-1/comments`. */
  path: string
  /** The `[id]` segment; omit for routes without one. */
  id?: string
  /** HTTP method; defaults to GET, or POST when a body is given. */
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

/** Build the request, call the handler and return status plus the parsed JSON body. */
export async function callRoute(handler: RouteHandler, options: CallRouteOptions) {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const request = new NextRequest(`http://localhost:3000${options.path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const params: Record<string, string> = options.id ? { id: options.id } : {}
  const response = await handler(request, { params: Promise.resolve(params) })
  const text = await response.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body, response }
}

export interface SeedListOptions {
  id?: string
  ownerId?: string
  privacy?: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  publicListType?: 'copy_only' | 'collaborative' | null
  /** List members by user id and role, e.g. `[{ userId: 'u2', role: 'member' }]`. */
  members?: Array<{ userId: string; role: string }>
}

/** A list row shaped like the route's list selection. */
export function listRow(options: SeedListOptions = {}) {
  const ownerId = options.ownerId ?? 'owner-id'
  return {
    id: options.id ?? 'list-1',
    name: 'List',
    ownerId,
    privacy: options.privacy ?? 'PRIVATE',
    publicListType: options.publicListType ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    owner: { id: ownerId, email: `${ownerId}@example.com`, name: ownerId, image: null },
    listMembers: (options.members ?? []).map(m => ({ ...m, user: { id: m.userId, email: `${m.userId}@example.com`, name: m.userId, image: null } })),
  }
}

/** A task row on one list, for `mockPrisma.task.findUnique`. */
export function taskOnList(
  overrides: Record<string, unknown> & { list?: SeedListOptions } = {}
) {
  const { list, ...rest } = overrides
  return {
    id: 'task-1',
    title: 'Task',
    creatorId: 'owner-id',
    assigneeId: null,
    assignee: null,
    lists: [listRow(list)],
    ...rest,
  }
}

/** Seed `mockPrisma.task.findUnique` with a task on a list. Returns the row. */
export function seedTask(overrides: Parameters<typeof taskOnList>[0] = {}) {
  const task = taskOnList(overrides)
  mockPrisma.task.findUnique.mockResolvedValue(task as never)
  return task
}
