/**
 * GET / PATCH / DELETE /api/v1/github/projects/{projectId}/binding
 * (AWTD-1151, spec §11.2) — read or edit a board's field mapping, or unbind.
 *
 * Owner only, like every other board-shaping change (authorizeBoardOwner).
 * Unbinding keeps the board and its tasks as an ordinary Astrid board.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { authorizeBoardOwner } from '@/lib/projects-service'
import { parseBindingPatch } from '@/lib/github/projects/binding-patch'
import { readBinding, unbindGitHubProject, updateBindingMapping } from '@/services/github-projects.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownerFailure(projectId: string, userId: string): Promise<NextResponse | null> {
  const owner = await authorizeBoardOwner(projectId, userId)
  if (!('error' in owner)) return null
  return owner.error === 'not_found'
    ? NextResponse.json({ error: 'Project not found' }, { status: 404 })
    : NextResponse.json({ error: 'Only the board owner can change its GitHub binding' }, { status: 403 })
}

const notBound = () => NextResponse.json({ error: 'This board is not bound to GitHub' }, { status: 404 })

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.github.projects.binding', capability: 'githubProjects' },
  async (_req, auth, { params }) => {
    const { id: projectId } = await params
    const failure = await ownerFailure(projectId, auth.userId)
    if (failure) return failure
    const binding = await readBinding(projectId)
    return binding ? NextResponse.json({ binding }) : notBound()
  },
)

export const PATCH = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.github.projects.binding', capability: 'githubProjects' },
  async (req, auth, { params }) => {
    const { id: projectId } = await params
    const parsed = parseBindingPatch(await req.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const failure = await ownerFailure(projectId, auth.userId)
    if (failure) return failure
    const exists = await readBinding(projectId)
    if (!exists) return notBound()
    await updateBindingMapping(projectId, parsed.value)
    const binding = await readBinding(projectId)
    return NextResponse.json({ binding })
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.github.projects.binding', capability: 'githubProjects' },
  async (_req, auth, { params }) => {
    const { id: projectId } = await params
    const failure = await ownerFailure(projectId, auth.userId)
    if (failure) return failure
    const exists = await readBinding(projectId)
    if (!exists) return notBound()
    await unbindGitHubProject(projectId)
    return NextResponse.json({ unbound: true, projectId })
  },
)
