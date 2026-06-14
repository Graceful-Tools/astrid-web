/**
 * PATCH /api/v1/lists/:id/favorite
 *
 * Toggle the favorite status of a list for the current user.
 * Mirrors PATCH /api/lists/[id]/favorite.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { toggleFavorite, hydrateSingleListFavorite } from '@/lib/favorites'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.favorite')

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.favorite' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params
      const { isFavorite } = await req.json()

      const list = await prisma.taskList.findFirst({
        where: {
          id: listId,
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
          ],
        },
      })
      if (!list) {
        return NextResponse.json(
          { error: 'List not found or access denied' },
          { status: 404 }
        )
      }

      await toggleFavorite(auth.userId, listId, isFavorite)

      const updatedList = await prisma.taskList.findUnique({
        where: { id: listId },
        include: {
          owner: true,
          listMembers: { include: { user: true } },
        },
      })
      if (!updatedList) {
        return NextResponse.json(
          { error: 'Failed to fetch updated list' },
          { status: 500 }
        )
      }

      let defaultAssignee = null
      if (
        updatedList.defaultAssigneeId &&
        updatedList.defaultAssigneeId !== 'unassigned'
      ) {
        defaultAssignee = await prisma.user.findUnique({
          where: { id: updatedList.defaultAssigneeId },
        })
      }
      const updatedListWithDefaultAssignee = { ...updatedList, defaultAssignee }
      await hydrateSingleListFavorite(updatedListWithDefaultAssignee, auth.userId)

      return NextResponse.json({
        success: true,
        isFavorite,
        listId,
        list: updatedListWithDefaultAssignee,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error toggling favorite')
      return NextResponse.json({ error: 'Failed to toggle favorite' }, { status: 500 })
    }
  }
)
