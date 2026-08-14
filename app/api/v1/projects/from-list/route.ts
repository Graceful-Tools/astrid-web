/**
 * Projects API v1 — create board from list (atomic)
 *
 * POST /api/v1/projects/from-list — atomically create a project board from a
 * list: create the project AND attach the list in one transaction. Replaces the
 * old two-request client flow that could leave orphan projects. Body: { listId }.
 *
 * iOS consumes this (see iOS V1APIContractIntegrationTests). The OAuth v1 variant
 * of the existing `POST /api/projects/from-list` session route. Response shape
 * matches `POST /api/v1/projects` — `{ project }` where `project` is the V1 shape
 * returned by listProjectsForUser (so the iOS `Project` decoder works unchanged).
 */

import { NextResponse } from 'next/server'
import { RedisCache } from '@/lib/redis'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { createProjectFromList } from '@/lib/projects-service'
import { projectModeGate } from '@/lib/project-mode'

const log = createLogger('v1.projects.from-list')

export const POST = withAuth(
  { scopes: ['projects:write'], tag: 'v1.projects.from-list' },
  async (req, auth) => {
    // Project Mode is request-gated (task dd7172d8). Same gate as the web
    // route and as POST /api/v1/projects — this endpoint creates a project
    // too, so without it v1 was exactly the way around the opt-in that the
    // sibling route's comment warns about. (Task e0613ae5.)
    const gated = await projectModeGate(auth.userId)
    if (gated) return gated

    const body = await req.json().catch(() => ({}))
    const listId = typeof body.listId === 'string' ? body.listId : ''

    if (!listId) {
      return NextResponse.json(
        { error: 'listId is required', meta: { apiVersion: 'v1', authSource: auth.source } },
        { status: 400 },
      )
    }

    const result = await createProjectFromList(auth.userId, listId)

    if ('error' in result) {
      const meta = { apiVersion: 'v1', authSource: auth.source }
      switch (result.error) {
        case 'list_not_found':
          return NextResponse.json({ error: 'List not found', meta }, { status: 404 })
        case 'forbidden':
          return NextResponse.json(
            { error: 'You can only create a board from a list you own', meta },
            { status: 403 },
          )
        default:
          return NextResponse.json({ error: result.message, meta }, { status: 400 })
      }
    }

    try {
      await RedisCache.invalidate.userLists(auth.userId)
    } catch (invalidateError) {
      log.error({ err: invalidateError }, 'Failed to invalidate user-lists cache after board creation')
    }

    return NextResponse.json(
      {
        project: result.project,
        list: result.list,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201 },
    )
  },
)
