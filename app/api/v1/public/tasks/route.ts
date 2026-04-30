/**
 * GET /api/v1/public/tasks
 *
 * Discovery feed of tasks in PUBLIC lists. Mirrors GET /api/public-tasks
 * (legacy) — same data, but wrapped in a v1 envelope with `meta` and
 * gated by withAuth (Bearer or session) instead of being unauthenticated.
 *
 * Query params:
 *   limit  — page size (default 100, max 200)
 *   offset — pagination offset
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.public.tasks')

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['public:read'], tag: 'v1.public.tasks' },
  async (req, auth) => {
    try {
      const { searchParams } = new URL(req.url)
      const take = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)
      const skip = parseInt(searchParams.get('offset') || '0', 10)

      const tasks = await prisma.task.findMany({
        where: {
          isPrivate: false,
          lists: { some: { privacy: 'PUBLIC' } },
        },
        include: {
          assignee: true,
          creator: true,
          lists: {
            where: { privacy: 'PUBLIC' },
            include: { owner: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      })

      return NextResponse.json({
        tasks,
        meta: {
          apiVersion: 'v1' as const,
          authSource: auth.source,
          count: tasks.length,
          limit: take,
          offset: skip,
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching public tasks')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
