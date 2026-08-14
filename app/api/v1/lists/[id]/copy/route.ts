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
import { hasExplicitListRole } from "@/lib/list-permissions"

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

    // `assignToUser` and `preserveTaskAssignees` come from the body and must not
    // be hardcoded: the web client posts `assignToUser: false` to THIS endpoint
    // when you copy a list you own from the Featured browser, meaning "bring the
    // tasks across unassigned, don't stamp me on all of them". The defaults below
    // are the old hardcoded values, so a body that omits them behaves as before.
    // (Task ba44d068.)
    const {
      includeTasks = true,
      newName,
      preserveTaskAssignees = false,
      assignToUser = true,
    } = body

    // Fetch the source list
    const sourceList = await prisma.taskList.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true }
        },
        // Membership travels with the list so access can be decided from this
        // payload rather than a second query (task e2803305).
        listMembers: { select: { userId: true, role: true } }
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
      const isMember = hasExplicitListRole({ id: auth.userId }, sourceList as never)

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
      preserveTaskAssignees,
      assignToUser,
      newOwnerName: currentUser?.name || currentUser?.email || undefined,
      newName: newName
    })

    if (!result.success) {
      // 400, matching legacy. copyListWithTasks returns { success: false } for
      // business-rule refusals — most often "Access denied to copy this list" —
      // and reporting those as 500 told the caller we had broken: the client
      // retries something that can never succeed, and a real outage becomes
      // indistinguishable from a permission denial in the logs. (Task e0613ae5.)
      return NextResponse.json(
        { error: result.error || 'Failed to copy list' },
        { status: 400 }
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
