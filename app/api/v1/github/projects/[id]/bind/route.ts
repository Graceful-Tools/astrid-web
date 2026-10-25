/**
 * POST /api/v1/github/projects/{nodeId}/bind — make a GitHub Project a board
 * (AWTD-1151, spec §11.2).
 *
 * Body: { installationId, mapping? } — mapping overrides the proposed Status /
 * Priority / due mapping (§9.2) field by field.
 *
 * The user must have access to that installation, and must be able to see
 * the project with their OWN token (GitHub enforces project visibility); the
 * project must belong to the installation's organization. Then the board is
 * created, and the initial import runs after the response (§8.7) on the
 * installation's token.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { runAfterResponse } from '@/lib/background'
import { installationSummariesForUser } from '@/lib/github/installations'
import { installationGraphqlClient, userGraphqlClient } from '@/lib/github/graphql-clients'
import { fetchProjectSchema, proposeBinding } from '@/lib/github/projects/bind'
import { githubAuthRequired, githubErrorResponse } from '@/lib/github/projects/http'
import { parseBindingPatch } from '@/lib/github/projects/binding-patch'
import { bindGitHubProject, importGitHubProject } from '@/services/github-projects.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The import runs after the response, inside this function's lifetime: a
// 2,000-item project is 20 pages (§13.3: ≤ 5 min). P4d moves it to the queue.
export const maxDuration = 300

export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.github.projects.bind', capability: 'githubProjects' },
  async (req, auth, { params }) => {
    const { id: projectNodeId } = await params
    const body = (await req.json().catch(() => null)) as { installationId?: unknown; mapping?: unknown } | null
    const installationId = Number(body?.installationId)
    if (!Number.isInteger(installationId)) {
      return NextResponse.json({ error: 'installationId is required' }, { status: 400 })
    }
    const mapping = parseBindingPatch(body?.mapping ?? {})
    if ('error' in mapping) return NextResponse.json({ error: mapping.error }, { status: 400 })

    const installation = (await installationSummariesForUser(auth.userId)).find(i => i.id === installationId)
    if (!installation || installation.suspended || installation.accountType !== 'Organization') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const client = await userGraphqlClient(auth.userId, 'write')
    if (!client) return githubAuthRequired()

    try {
      const schema = await fetchProjectSchema(client, projectNodeId)
      if (!schema) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      if (schema.owner.__typename !== 'Organization' || schema.owner.login.toLowerCase() !== installation.accountLogin.toLowerCase()) {
        return NextResponse.json({ error: 'That project does not belong to this organization' }, { status: 400 })
      }

      const proposal = { ...proposeBinding(schema), ...mapping.value }
      const result = await bindGitHubProject({ userId: auth.userId, installationId, schema, proposal })
      if (!result.ok) {
        return NextResponse.json({ error: result.error, projectId: result.projectId }, { status: result.status })
      }

      runAfterResponse('github-project-import', () =>
        importGitHubProject(result.projectId, installationGraphqlClient(installationId, 'hydrate')),
      )

      return NextResponse.json(
        { projectId: result.projectId, listId: result.listId, mapping: proposal, importing: true },
        { status: 201 },
      )
    } catch (err) {
      const mapped = githubErrorResponse(err)
      if (mapped) return mapped
      throw err
    }
  },
)
