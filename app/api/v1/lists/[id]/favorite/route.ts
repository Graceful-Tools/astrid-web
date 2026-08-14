/**
 * PATCH /api/v1/lists/:id/favorite
 *
 * Toggle the favorite status of a list for the current user.
 *
 * The rule lives in lib/list-favorite.ts and is shared with the legacy route;
 * this handler owns only OAuth scope auth and the `meta` envelope, which is
 * what actually differs between the two. (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { setListFavorite } from '@/lib/list-favorite'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.favorite')

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.favorite' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params
      const { isFavorite } = await req.json()

      const result = await setListFavorite({ userId: auth.userId, listId, isFavorite })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        success: true,
        isFavorite: result.isFavorite,
        listId,
        list: result.list,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error toggling favorite')
      return NextResponse.json({ error: 'Failed to toggle favorite' }, { status: 500 })
    }
  }
)
