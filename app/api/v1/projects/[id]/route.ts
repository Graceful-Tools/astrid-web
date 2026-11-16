/**
 * Individual Project API v1
 *
 * DELETE /api/v1/projects/:id - Tear down a project (owner only):
 *   detach domain lists, cascade-delete project + status lists.
 *
 * The legacy /api/projects/[id] it once mirrored was deleted (AWTD-839).
 *
 * PATCH /api/v1/projects/:id { key } - Rename the task-id key (owner only,
 *   AWTD-1024). Tasks become NEW-N; OLD-N keeps resolving as an alias.
 * PATCH /api/v1/projects/:id { name } - Rename the project (owner or project
 *   admin, ADEV-48). Sent with `key`, it stays owner-only.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { RedisCache } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import {
  authorizeBoardOwner,
  authorizeProjectListMove,
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
    const hasKey = !!body && typeof body === 'object' && 'key' in body
    const hasName = !!body && typeof body === 'object' && 'name' in body
    if (!hasKey && !hasName) {
      return NextResponse.json({ error: 'Nothing to update: send { name } or { key }' }, { status: 400 })
    }

    let name: string | undefined
    if (hasName) {
      name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) {
        return NextResponse.json(
          { error: 'name must not be empty', code: 'PROJECT_NAME_REQUIRED' },
          { status: 400 },
        )
      }
    }

    // The key is the owner's alone (AWTD-1024). The name is the owner's or a
    // project admin's (ADEV-48), the same bar as moving a list in or out.
    const allowed = hasKey
      ? await authorizeBoardOwner(projectId, auth.userId)
      : await authorizeProjectListMove(projectId, auth.userId)
    if ('error' in allowed) {
      if (allowed.error === 'not_found') {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      return hasKey
        ? NextResponse.json({ error: 'Only the owner can rename a project key' }, { status: 403 })
        : NextResponse.json(
            { error: 'Only the owner or a project admin can rename a project', code: 'PROJECT_RENAME_FORBIDDEN' },
            { status: 403 },
          )
    }

    let keyResult: { key: string; previousKey: string | null } | undefined
    if (hasKey) {
      const result = await renameProjectKey(projectId, body.key)
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      keyResult = result
    }

    const renamed =
      name === undefined
        ? undefined
        : await prisma.project.update({
            where: { id: projectId },
            data: { name },
            select: { id: true, name: true },
          })

    // Every member's cached lists carry the project's name and task identifiers.
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
      project: {
        id: projectId,
        ...(renamed ? { name: renamed.name } : {}),
        ...(keyResult ? { key: keyResult.key } : {}),
      },
      ...(keyResult ? { previousKey: keyResult.previousKey } : {}),
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
