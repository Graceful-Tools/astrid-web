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

// Cache the OAuth token (valid for 1 hour typically)
let tokenCache: { token: string; expiresAt: number } | null = null

/**
 * Get a valid OAuth access token for Astrid.
 * Creates the OAuth client if it doesn't exist.
 */
async function getAstridToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token
  }

  // Find or create Astrid's OAuth client
  const astridUser = await prisma.user.findFirst({
    where: { email: ASTRID_EMAIL, isAIAgent: true },
    select: { id: true },
  })
  if (!astridUser) throw new Error('Astrid agent user not found')

  let oauthClient = await prisma.oAuthClient.findFirst({
    where: { userId: astridUser.id },
    select: { id: true, clientId: true },
  })

  if (!oauthClient) {
    // Create OAuth client for Astrid (one-time setup)
    const { createOAuthClient } = await import('@/lib/oauth/oauth-client-manager')
    const credentials = await createOAuthClient({
      userId: astridUser.id,
      name: 'Astrid Agent',
      scopes: ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write'],
      grantTypes: ['client_credentials'],
    })
    // Fetch the created client's database ID
    const created = await prisma.oAuthClient.findFirst({
      where: { clientId: credentials.clientId },
      select: { id: true, clientId: true },
    })
    if (!created) throw new Error('Failed to create OAuth client for Astrid')
    oauthClient = created
  }

  // Generate access token — uses the database `id`, not the `clientId` field
  const tokenResult = await generateAccessToken(
    oauthClient.id,
    astridUser.id,
    ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write']
  )

  tokenCache = {
    token: tokenResult.accessToken,
    expiresAt: Date.now() + tokenResult.expiresIn * 1000,
  }

  return tokenResult.accessToken
}

/**
 * Get the base URL for internal API calls.
 */
function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

/**
 * Make an authenticated API call as Astrid.
 */
async function astridFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAstridToken()
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
  const res = await astridFetch('/api/v1/tasks', {
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

  const res = await astridFetch(`/api/v1/tasks/${params.taskId}`, {
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
}): Promise<{ id: string; title: string }> {
  return astridUpdateTask({ taskId: params.taskId, completed: true })
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

  const res = await astridFetch(`/api/v1/tasks?${queryParams}`)

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
  content: string
}): Promise<{ id: string }> {
  const res = await astridFetch(`/api/v1/tasks/${params.taskId}/comments`, {
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
