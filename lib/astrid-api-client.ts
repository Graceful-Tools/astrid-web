/**
 * Astrid API Client
 *
 * Makes authenticated API calls to the Astrid v1 API on behalf of Astrid.
 * Uses the same HTTP endpoints that mobile apps and external agents use.
 * Authenticates via OAuth client credentials (same as OpenClaw agents).
 */

import { prisma } from '@/lib/prisma'
import { generateAccessToken } from '@/lib/oauth/oauth-token-manager'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'

// Cache tokens per user (valid for 1 hour typically)
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// Cache the OAuth client ID (created once)
let oauthClientId: string | null = null

/**
 * Ensure Astrid's OAuth client exists and return its database ID.
 */
async function ensureAstridOAuthClient(): Promise<string> {
  if (oauthClientId) return oauthClientId

  const astridUser = await prisma.user.findFirst({
    where: { email: ASTRID_EMAIL, isAIAgent: true },
    select: { id: true },
  })
  if (!astridUser) throw new Error('Astrid agent user not found')

  let client = await prisma.oAuthClient.findFirst({
    where: { userId: astridUser.id },
    select: { id: true },
  })

  if (!client) {
    const { createOAuthClient } = await import('@/lib/oauth/oauth-client-manager')
    const credentials = await createOAuthClient({
      userId: astridUser.id,
      name: 'Astrid Agent',
      scopes: ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write'],
      grantTypes: ['client_credentials'],
    })
    const created = await prisma.oAuthClient.findFirst({
      where: { clientId: credentials.clientId },
      select: { id: true },
    })
    if (!created) throw new Error('Failed to create OAuth client for Astrid')
    client = created
  }

  oauthClientId = client.id
  return client.id
}

/**
 * Get a valid OAuth access token that acts on behalf of a specific user.
 * Astrid's OAuth client is the app, but the token carries the user's identity
 * so all permission checks pass as if the user is making the request.
 */
async function getTokenForUser(userId: string): Promise<string> {
  const cached = tokenCache.get(userId)
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token
  }

  const clientId = await ensureAstridOAuthClient()

  const tokenResult = await generateAccessToken(
    clientId,
    userId, // Token carries the USER's identity, not Astrid's
    ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write']
  )

  tokenCache.set(userId, {
    token: tokenResult.accessToken,
    expiresAt: Date.now() + tokenResult.expiresIn * 1000,
  })

  return tokenResult.accessToken
}

/**
 * Get the base URL for internal API calls.
 */
function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

/**
 * Make an authenticated API call on behalf of a user via Astrid's OAuth client.
 */
async function astridFetch(path: string, userId: string, options: RequestInit = {}): Promise<Response> {
  const token = await getTokenForUser(userId)
  const baseUrl = getBaseUrl()

  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

// ─── Task Operations ──────────────────────────────────────────────

export async function astridCreateTask(params: {
  title: string
  description?: string
  assigneeId?: string | null
  creatorId: string
  listIds?: string[]
  priority?: number
  dueDateTime?: Date | null
}): Promise<{ id: string; title: string }> {
  const res = await astridFetch('/api/v1/tasks', params.creatorId, {
    method: 'POST',
    body: JSON.stringify({
      title: params.title,
      description: params.description || '',
      assigneeId: params.assigneeId || undefined,
      listIds: params.listIds || [],
      priority: params.priority ?? 0,
      dueDateTime: params.dueDateTime?.toISOString() || undefined,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Create task failed: ${err.error || res.status}`)
  }

  const data = await res.json()
  return { id: data.task.id, title: data.task.title }
}

export async function astridUpdateTask(params: {
  taskId: string
  userId: string
  title?: string
  description?: string
  priority?: number
  dueDateTime?: Date | null
  assigneeId?: string | null
  completed?: boolean
}): Promise<{ id: string; title: string }> {
  const body: Record<string, unknown> = {}
  if (params.title !== undefined) body.title = params.title
  if (params.description !== undefined) body.description = params.description
  if (params.priority !== undefined) body.priority = params.priority
  if (params.dueDateTime !== undefined) body.dueDateTime = params.dueDateTime?.toISOString() || null
  if (params.assigneeId !== undefined) body.assigneeId = params.assigneeId
  if (params.completed !== undefined) body.completed = params.completed

  const res = await astridFetch(`/api/v1/tasks/${params.taskId}`, params.userId, {
    method: 'PUT',
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Update task failed: ${err.error || res.status}`)
  }

  const data = await res.json()
  return { id: data.task.id, title: data.task.title }
}

export async function astridCompleteTask(params: {
  taskId: string
  userId: string
}): Promise<{ id: string; title: string }> {
  return astridUpdateTask({ taskId: params.taskId, userId: params.userId, completed: true })
}

export async function astridListTasks(params: {
  userId: string
  listId?: string | null
  includeCompleted?: boolean
  limit?: number
}): Promise<Array<{ id: string; title: string; completed: boolean; priority: number; dueDate: string | null }>> {
  const queryParams = new URLSearchParams()
  if (params.listId) queryParams.set('listId', params.listId)
  if (params.includeCompleted) queryParams.set('completed', 'true')
  if (params.limit) queryParams.set('limit', String(params.limit))

  const res = await astridFetch(`/api/v1/tasks?${queryParams}`, params.userId)

  if (!res.ok) {
    throw new Error(`List tasks failed: ${res.status}`)
  }

  const data = await res.json()
  return (data.tasks || []).map((t: { id: string; title: string; completed: boolean; priority: number; dueDateTime?: string }) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    priority: t.priority,
    dueDate: t.dueDateTime || null,
  }))
}

export async function astridAddComment(params: {
  taskId: string
  userId: string
  content: string
}): Promise<{ id: string }> {
  const res = await astridFetch(`/api/v1/tasks/${params.taskId}/comments`, params.userId, {
    method: 'POST',
    body: JSON.stringify({
      content: params.content,
      type: 'MARKDOWN',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Add comment failed: ${err.error || res.status}`)
  }

  const data = await res.json()
  return { id: data.comment?.id || data.id }
}
