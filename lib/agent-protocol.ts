/**
 * Agent Protocol — Shared utilities for agent API endpoints
 *
 * Provides authentication, task enrichment, and types for the
 * generalized agent protocol (/api/v1/agent/*).
 */

import { type NextRequest } from 'next/server'
import { authenticateAPI, type AuthContext, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { hasRequiredScopes } from '@/lib/oauth/oauth-scopes'
import { prisma } from '@/lib/prisma'

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentTask {
  id: string
  title: string
  description: string
  priority: number
  completed: boolean
  dueDateTime: string | null
  isAllDay: boolean
  listId: string | null
  listName: string | null
  listDescription: string | null
  assignerName: string | null
  assignerId: string | null
  comments: AgentComment[]
  /**
   * Null when the source row had no usable timestamp (task aca946b8). The
   * alternative was throwing RangeError mid-broadcast, or inventing `now` —
   * a lie the agent cannot tell apart from a real timestamp. Every other
   * unknown on this payload is already `| null`, so this matches.
   */
  createdAt: string | null
  updatedAt: string | null
}

export interface AgentComment {
  id: string
  content: string
  authorName: string | null
  authorId: string
  isAgent: boolean
  /** Null when unknown — see AgentTask.createdAt (task aca946b8). */
  createdAt: string | null
}

export interface AgentEventPayload {
  taskId: string
  task: AgentTask
}

export interface TaskCommentedPayload extends AgentEventPayload {
  comment: AgentComment
}

export interface TaskUpdatedPayload extends AgentEventPayload {
  changes: Record<string, { from: unknown; to: unknown }>
}

export type AgentEventType =
  | 'task.assigned'
  | 'task.commented'
  | 'task.updated'
  | 'task.completed'
  | 'task.deleted'

// ── Authentication ─────────────────────────────────────────────────────

/**
 * Authenticate an agent request via OAuth Bearer token.
 * Returns the auth context — the authenticated user must be an AI agent.
 */
/**
 * Authenticate an agent request via OAuth Bearer token.
 * Validates required scopes based on the operation.
 */
export async function authenticateAgentRequest(
  req: NextRequest,
  requiredScopes: string[] = ['tasks:read']
): Promise<AuthContext> {
  const auth = await authenticateAPI(req)

  // Check required scopes (wildcard always passes)
  if (!hasRequiredScopes(auth.scopes, ['*'])) {
    for (const scope of requiredScopes) {
      if (!hasRequiredScopes(auth.scopes, [scope])) {
        throw new ForbiddenError(`Missing required scope: ${scope}`)
      }
    }
  }

  return auth
}

// ── Task Enrichment ────────────────────────────────────────────────────

/**
 * Enrich a Prisma task record with list description and formatted fields
 * for agent consumption.
 */
export function enrichTaskForAgent(task: any): AgentTask {
  const list = task.lists?.[0] || null

  return {
    id: task.id,
    title: task.title,
    description: task.description || '',
    priority: task.priority ?? 0,
    completed: task.completed ?? false,
    dueDateTime: task.dueDateTime ? new Date(task.dueDateTime).toISOString() : null,
    isAllDay: task.isAllDay ?? false,
    listId: list?.id || null,
    listName: list?.name || null,
    listDescription: list?.description || null,
    assignerName: task.creator?.name || task.creator?.email || null,
    assignerId: task.creator?.id || null,
    comments: (task.comments || []).map((c: any) => ({
      id: c.id,
      content: c.content,
      authorName: c.author?.name || c.author?.email || null,
      authorId: c.author?.id || c.authorId,
      isAgent: c.author?.isAIAgent ?? false,
      createdAt: isoOrNull(c.createdAt),
    })),
    createdAt: isoOrNull(task.createdAt),
    updatedAt: isoOrNull(task.updatedAt),
  }
}

/**
 * A date as ISO, or null when there isn't one (task aca946b8).
 *
 * `new Date(undefined).toISOString()` throws `RangeError: Invalid time value`.
 * That never broke a request — both call sites in the v1 task route sit inside
 * a `catch (sseError)` — but it printed a RangeError into the output of runs
 * that PASSED, which read like a crash in the clear-a-due-date path and cost a
 * second full run to disprove. A scary log line during a green run teaches
 * people to distrust green.
 *
 * NULL RATHER THAN `now`: an invented timestamp is a lie the agent cannot tell
 * apart from a real one. "I don't know" is the honest payload.
 */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// ── Event Type Mapping ────────────────────────────────────────────────

/** Internal SSE event types relevant to agent consumers */
export const AGENT_EVENT_TYPES = new Set([
  'task_assigned',
  'task_created',
  'task_updated',
  'task_completed',
  'task_deleted',
  'comment_created',
  'comment_added',
  'agent_task_comment',
])

/** Map internal event types to protocol event names (e.g. task.assigned) */
export function mapEventType(type: string): AgentEventType | null {
  switch (type) {
    case 'task_assigned':
    case 'task_created':
      return 'task.assigned'
    case 'task_updated':
      return 'task.updated'
    case 'task_completed':
      return 'task.completed'
    case 'task_deleted':
      return 'task.deleted'
    case 'comment_created':
    case 'comment_added':
    case 'agent_task_comment':
      return 'task.commented'
    default:
      return null
  }
}

// ── Prisma Includes ────────────────────────────────────────────────────

/** Standard Prisma include for agent task queries */
export const agentTaskInclude = {
  lists: {
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
    },
  },
  assignee: {
    select: {
      id: true,
      name: true,
      email: true,
      isAIAgent: true,
    },
  },
  creator: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  comments: {
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          isAIAgent: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
}

// ── SSE Event Transform ───────────────────────────────────────────────

/**
 * Transform a cached SSE event into the agent protocol format.
 *
 * Cached events (from broadcastToUsers → getMissedEvents) have the shape:
 *   { type: 'task_assigned', timestamp: '...', data: { taskId, title, ... } }
 *
 * Agent protocol expects named SSE events with structured payloads:
 *   event: task.assigned\ndata: { taskId, task: AgentTask }
 *
 * For task_assigned/task_created we fetch the full task from DB to include
 * listDescription and properly formatted AgentTask fields.
 */
export async function transformEventForAgent(
  cachedEvent: any
): Promise<{ type: string; data: any } | null> {
  const internalType = cachedEvent.type
  const mappedType = mapEventType(internalType)
  if (!mappedType) return null

  const data = cachedEvent.data || {}

  if (internalType === 'task_assigned' || internalType === 'task_created') {
    const taskId = data.taskId
    if (!taskId) return null

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: agentTaskInclude,
    })
    if (!task) return null

    return { type: mappedType, data: { taskId, task: enrichTaskForAgent(task) } }
  }

  if (internalType === 'comment_created' || internalType === 'comment_added') {
    const comment = data.comment
    return {
      type: mappedType,
      data: {
        taskId: data.taskId,
        comment: comment
          ? {
              id: comment.id,
              content: comment.content,
              authorName: comment.author?.name || comment.author?.email || null,
              authorId: comment.authorId || comment.author?.id,
              isAgent: comment.author?.isAIAgent ?? false,
              createdAt: comment.createdAt,
            }
          : null,
      },
    }
  }

  // task_updated, task_completed, task_deleted — pass through with taskId
  return { type: mappedType, data: { taskId: data.taskId, ...data } }
}
