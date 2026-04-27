/**
 * Copy List API v1
 *
 * POST /api/v1/lists/:id/copy - Copy a public list to your account
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { copyListWithTasks } from '@/lib/copy-utils'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * POST /api/v1/lists/:id/copy
 * Copy a public list to your account
 *
 * Body:
 * {
 *   includeTasks?: boolean (default: true)
 *   newName?: string (optional - defaults to "Copy of [Original Name]")
 * }
 */
export const POST = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.copy' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const { includeTasks = true, newName } = body

    // Fetch the source list
    const sourceList = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true }
        }
      }
    })

    if (!sourceList) {
      return NextResponse.json(
        { error: 'List not found' },
        { status: 404 }
      )
    }

    // Check if list is public or user has access
    if (sourceList.privacy !== 'PUBLIC') {
      // Check if user is owner or member
      const isMember = sourceList.ownerId === auth.userId ||
        await prisma.listMember.findFirst({
          where: {
            listId: id,
            userId: auth.userId
          }
        })

      if (!isMember) {
        return NextResponse.json(
          { error: 'Cannot copy private lists you don\'t have access to' },
          { status: 403 }
        )
      }
    }

    // Get current user info for naming
    const currentUser = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true, email: true }
    })

    // Copy the list
    const result = await copyListWithTasks(id, {
      newOwnerId: auth.userId,
      includeTasks,
      preserveTaskAssignees: false,
      assignToUser: true,
      newOwnerName: currentUser?.name || currentUser?.email || undefined,
      newName: newName
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to copy list' },
        { status: 500 }
      )
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: `List copied successfully with ${result.copiedTasksCount} tasks`,
        list: result.copiedList,
        copiedTasksCount: result.copiedTasksCount,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)
