/**
 * Shortcodes API v1
 *
 * RESTful endpoint for shortcode operations
 * POST /api/v1/shortcodes - Create shortcode for sharing
 * GET /api/v1/shortcodes - Get shortcodes for a target
 */

import { NextResponse } from 'next/server'
import { createShortcode, getShortcodesForTarget, buildShortcodeUrl } from '@/lib/shortcode'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-auth-wrapper'

type TargetType = 'task' | 'list'

type AccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string }

/**
 * Validates targetType + targetId and confirms the caller has access. Returns
 * `{ ok: true }` on success, otherwise an HTTP-shaped failure object that the
 * handler renders directly.
 */
async function checkTargetAccess(
  targetType: unknown,
  targetId: unknown,
  userId: string
): Promise<AccessResult> {
  if (!targetType || !targetId) {
    return { ok: false, status: 400, error: 'Validation error', message: 'targetType and targetId are required' }
  }

  if (targetType !== 'task' && targetType !== 'list') {
    return { ok: false, status: 400, error: 'Validation error', message: 'targetType must be "task" or "list"' }
  }

  if (targetType === 'task') {
    const task = await prisma.task.findUnique({
      where: { id: targetId as string },
      include: { lists: true }
    })

    if (!task) {
      return { ok: false, status: 404, error: 'Not found', message: 'Task not found' }
    }

    if (task.creatorId === userId) return { ok: true }

    const listIds = task.lists.map(list => list.id)
    const hasAccess = await prisma.taskList.findFirst({
      where: {
        id: { in: listIds },
        OR: [
          { ownerId: userId },
          { listMembers: { some: { userId } } }
        ]
      }
    })

    if (!hasAccess) {
      return { ok: false, status: 403, error: 'Forbidden', message: "You don't have access to this task" }
    }

    return { ok: true }
  }

  const list = await prisma.taskList.findFirst({
    where: {
      id: targetId as string,
      OR: [
        { ownerId: userId },
        { listMembers: { some: { userId } } }
      ]
    }
  })

  if (!list) {
    return { ok: false, status: 404, error: 'Not found', message: 'List not found or access denied' }
  }

  return { ok: true }
}

function denied(result: Extract<AccessResult, { ok: false }>, authSource: string) {
  return NextResponse.json(
    {
      error: result.error,
      message: result.message,
      meta: { apiVersion: 'v1', authSource },
    },
    { status: result.status }
  )
}

/**
 * POST /api/v1/shortcodes
 * Create a new shortcode for a task or list
 *
 * Body:
 * - targetType: "task" | "list"
 * - targetId: string (UUID)
 * - expiresAt?: string (ISO date, optional)
 */
export const POST = withAuth(
  // Require at least tasks:read to create share links
  { scopes: ['tasks:read'], tag: 'v1.shortcodes' },
  async (req, auth) => {
    const body = await req.json()
    const { targetType, targetId, expiresAt } = body

    const access = await checkTargetAccess(targetType, targetId, auth.userId)
    if (!access.ok) return denied(access, auth.source)

    const shortcode = await createShortcode({
      targetType: targetType as TargetType,
      targetId,
      userId: auth.userId,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    })

    return NextResponse.json({
      shortcode,
      url: buildShortcodeUrl(shortcode.code),
      meta: { apiVersion: 'v1', authSource: auth.source }
    })
  }
)

/**
 * GET /api/v1/shortcodes?targetType=task&targetId=xxx
 * Get all shortcodes for a target
 */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.shortcodes' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const targetType = searchParams.get('targetType')
    const targetId = searchParams.get('targetId')

    const access = await checkTargetAccess(targetType, targetId, auth.userId)
    if (!access.ok) return denied(access, auth.source)

    const shortcodes = await getShortcodesForTarget(
      targetType as TargetType,
      targetId as string
    )

    return NextResponse.json({
      shortcodes: shortcodes.map((sc) => ({
        ...sc,
        url: buildShortcodeUrl(sc.code)
      })),
      meta: {
        apiVersion: 'v1',
        authSource: auth.source,
        count: shortcodes.length
      }
    })
  }
)
