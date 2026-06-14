/**
 * Projects API v1
 *
 * GET  /api/v1/projects - List the caller's projects (status boards)
 * POST /api/v1/projects - Create a project + seed Ready/Doing/Waiting
 *
 * iOS consumes this. Response shape is pinned by V1Project /
 * V1ProjectsResponse / V1ProjectResponse in lib/api-contracts/v1-ios-shapes.ts
 * and tests/api/v1-contract.test.ts.
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { RedisCache } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { createProjectForUser, listProjectsForUser } from '@/lib/projects-service'
import { requireProjectsBeta } from '@/lib/feature-flags'

const log = createLogger('v1.projects')

export const GET = withAuth(
  { scopes: ['projects:read'], tag: 'v1.projects' },
  async (_req, auth) => {
    const projects = await listProjectsForUser(auth.userId)

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        projects,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers },
    )
  },
)

export const POST = withAuth(
  { scopes: ['projects:write'], tag: 'v1.projects' },
  async (req, auth) => {
    // Projects is an opt-in Beta — only enrolled users can create boards.
    if (!(await requireProjectsBeta(auth.userId))) {
      return NextResponse.json({ error: 'Projects is in beta. Enable it in Settings to create boards.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const project = await createProjectForUser(auth.userId, {
      name,
      description: body.description,
      color: body.color,
      imageUrl: body.imageUrl,
    })

    try {
      await RedisCache.invalidate.userLists(auth.userId)
    } catch (invalidateError) {
      log.error({ err: invalidateError }, 'Failed to invalidate user-lists cache after project creation')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        project,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201, headers },
    )
  },
)
