/**
 * Public Lists API v1
 *
 * GET /api/v1/public/lists - Browse public lists
 */

import { NextResponse } from 'next/server'
import { parseLimit } from '@/lib/pagination'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { getTaskCountInclude, getMultipleListTaskCounts } from '@/lib/task-count-utils'
import { withAuth } from '@/lib/api-auth-wrapper'

/**
 * GET /api/v1/public/lists
 * Browse public lists with filtering and sorting
 *
 * Query params:
 * - sortBy: 'popular' | 'recent' | 'name' (default: 'popular')
 * - limit: number (default: 50, max: 100)
 */
export const GET = withAuth(
  { scopes: ['lists:read'], tag: 'v1.public.lists' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const sortBy = searchParams.get('sortBy') || 'popular'
    // Math.min(NaN, 100) is NaN, so the old cap never rescued a non-numeric
    // limit — it reached Prisma's take. (Task e0613ae5.)
    const limit = parseLimit(searchParams.get('limit'), { fallback: 50, max: 100 })

    // Build query for public lists
    const whereClause: any = {
      privacy: 'PUBLIC',
    }

    // Exclude lists the user owns or is admin of (to avoid duplicates)
    if (auth.userId) {
      whereClause.AND = [
        { ownerId: { not: auth.userId } },
        {
          NOT: {
            listMembers: {
              some: {
                userId: auth.userId,
                role: 'admin'
              }
            }
          }
        }
      ]
    }

    // Determine sort order
    let orderBy: any = {}
    switch (sortBy) {
      case 'recent':
        orderBy = { createdAt: 'desc' }
        break
      case 'name':
        orderBy = { name: 'asc' }
        break
      case 'popular':
      default:
        // copyCount is what popularity MEANS here — the legacy route has
        // always sorted [copyCount desc, createdAt desc], with createdAt as
        // the tie-break rather than the sort. This branch used createdAt
        // alone behind a "for now" comment, so "popular" returned "newest"
        // and a much-copied list never surfaced. It is also the DEFAULT
        // branch, so that was what a client got when it asked for nothing.
        // (Task e0613ae5.)
        orderBy = [{ copyCount: 'desc' }, { createdAt: 'desc' }]
        break
    }

    // Fetch public lists
    const lists = await prisma.taskList.findMany({
      where: whereClause,
      orderBy,
      take: limit,
      include: {
        owner: {
          select: { id: true, name: true, email: true, image: true }
        },
        listMembers: {
          select: {
            userId: true,
            role: true,
            user: {
              select: { id: true, name: true, image: true }
            }
          }
        },
        ...getTaskCountInclude({ includeCompleted: false, includePrivate: false, isPublicContext: true }),
        _count: {
          select: {
            listMembers: true
          }
        }
      }
    })

    // Get accurate incomplete task counts for public lists
    const listIds = lists.map(list => list.id)
    const taskCounts = await getMultipleListTaskCounts(listIds, {
      includeCompleted: false,
      includePrivate: false,
      isPublicContext: true
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        lists: lists.map(list => ({
          id: list.id,
          name: list.name,
          description: list.description,
          color: list.color,
          privacy: list.privacy,
          publicListType: list.publicListType,
          imageUrl: list.imageUrl,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt,
          owner: list.owner,
          admins: list.listMembers
            .filter(m => m.role === 'admin')
            .map(m => m.user),
          taskCount: taskCounts[list.id] || 0,
          memberCount: list._count.listMembers + 1, // +1 for owner
        })),
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
          count: lists.length,
          sortBy,
        },
      },
      { headers }
    )
  }
)
