/**
 * Individual Project API v1
 *
 * DELETE /api/v1/projects/:id - Tear down a project (owner only):
 *   detach domain lists, cascade-delete project + status lists.
 *
 * Mirrors /api/projects/[id] but via OAuth + projects:delete scope.
 *
 * PATCH /api/v1/projects/:id { key } - Rename the task-id key (owner only,
 *   AWTD-1024). Tasks become NEW-N; OLD-N keeps resolving as an alias.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { RedisCache } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import {
  authorizeBoardOwner,
  collectProjectMemberUserIds,
  deleteProjectAndDetachLists,
} from '@/lib/projects-service'
import { renameProjectKey } from '@/lib/task-identifier'

const log = createLogger('v1.projects.id')

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.id' },
  async (req, auth, { params }) => {
    const { id: projectId } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('key' in body)) {
      return NextResponse.json({ error: 'Nothing to update: send { key }' }, { status: 400 })
    }

    const owner = await authorizeBoardOwner(projectId, auth.userId)
    if ('error' in owner) {
      return owner.error === 'not_found'
        ? NextResponse.json({ error: 'Project not found' }, { status: 404 })
        : NextResponse.json({ error: 'Only the owner can rename a project key' }, { status: 403 })
    }

    const result = await renameProjectKey(projectId, body.key)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Every member's tasks just changed identifier.
    const userIds = await collectProjectMemberUserIds([projectId])
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          await RedisCache.invalidate.userListsAllVersions(userId)
        } catch (error) {
          log.error({ err: error }, `Failed to invalidate cache for user ${userId}`)
        }
      }),
    )

    return NextResponse.json({
      project: { id: projectId, key: result.key },
      previousKey: result.previousKey,
      meta: { apiVersion: 'v1', authSource: auth.source },
    })
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['projects:delete'], tag: 'v1.projects.id' },
  async (_req, auth, { params }) => {
    const { id: projectId } = await params

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.ownerId !== auth.userId) {
      return NextResponse.json(
        { error: 'Only the owner can delete a project' },
        { status: 403 },
      )
    }

    const result = await deleteProjectAndDetachLists(projectId)
    if (!result) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    await Promise.all(
      Array.from(result.userIdsToInvalidate).map(async (userId) => {
        try {
          await RedisCache.invalidate.userListsAllVersions(userId)
        } catch (error) {
          log.error({ err: error }, `Failed to invalidate cache for user ${userId}`)
        }
      }),
    )

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        success: true,
        detachedListIds: result.detachedListIds,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers },
    )
  },
)
