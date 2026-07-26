/**
 * POST /api/v1/lists/:id/leave
 *
 * Leaves a list. Refuses with 400 if the user is the last admin.
 * Mirrors POST /api/lists/[id]/leave.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'
import { canUserManageList } from "@/lib/list-permissions"

const log = createLogger('v1.lists.leave')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.leave' },
  async (_req, auth, { params }) => {
    try {
      const { id: listId } = await params

      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        select: { id: true, name: true, ownerId: true },
      })
      if (!list) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 })
      }

      const userMember = await prisma.listMember.findFirst({
        where: { listId, userId: auth.userId },
      })
      if (!userMember) {
        return NextResponse.json(
          { error: 'You are not a member of this list' },
          { status: 404 }
        )
      }

      const isUserAdmin = userMember.role === 'admin' || canUserManageList({ id: auth.userId }, list as never)

      if (isUserAdmin) {
        const adminCount = await prisma.listMember.count({
          where: { listId, role: 'admin' },
        })
        const ownerIsAdmin = await prisma.listMember.findFirst({
          where: { listId, userId: list.ownerId, role: 'admin' },
        })
        const totalAdmins = adminCount + (list.ownerId && !ownerIsAdmin ? 1 : 0)
        if (totalAdmins <= 1) {
          return NextResponse.json(
            {
              error: 'Cannot leave as the last admin. Either promote another member to admin or delete the list.',
              isLastAdmin: true,
            },
            { status: 400 }
          )
        }
      }

      const deleteResult = await prisma.listMember.deleteMany({
        where: { listId, userId: auth.userId },
      })
      if (deleteResult.count === 0) {
        return NextResponse.json(
          { error: 'You are not a member of this list' },
          { status: 404 }
        )
      }

      if (auth.user.email) {
        await prisma.listInvite.deleteMany({
          where: { listId, email: auth.user.email },
        })
      }

      try {
        await RedisCache.del(RedisCache.keys.userLists(auth.userId))
      } catch (error) {
        log.error({ err: error }, 'Failed to invalidate user-lists cache')
      }

      return NextResponse.json({
        message: 'Successfully left the list',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error leaving list')
      return NextResponse.json({ error: 'Failed to leave list' }, { status: 500 })
    }
  }
)
