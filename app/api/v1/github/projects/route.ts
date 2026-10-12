/**
 * GET /api/v1/github/projects — projects the user can bind (AWTD-1151, §11.2).
 *
 * Every organization installation the user has access to, and in each, the
 * org's projects AS THIS USER SEES THEM: read with the user's own App token,
 * so GitHub decides visibility (a private project they cannot open is not
 * listed). Each says whether it is already bound, and to which board.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { installationSummariesForUser } from '@/lib/github/installations'
import { userGraphqlClient } from '@/lib/github/graphql-clients'
import { fetchOrgProjects } from '@/lib/github/projects/bind'
import { githubAuthRequired, githubErrorResponse } from '@/lib/github/projects/http'
import { boardsForProjectNodes } from '@/services/github-projects.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['projects:read'], tag: 'v1.github.projects', capability: 'githubProjects' },
  async (_req, auth) => {
    const orgs = (await installationSummariesForUser(auth.userId)).filter(
      i => i.accountType === 'Organization' && !i.suspended,
    )
    if (orgs.length === 0) return NextResponse.json({ installations: [] })

    const client = await userGraphqlClient(auth.userId, 'write')
    if (!client) return githubAuthRequired()

    try {
      const perOrg = await Promise.all(
        orgs.map(async org => ({ org, projects: await fetchOrgProjects(client, org.accountLogin) })),
      )
      const boardFor = await boardsForProjectNodes(perOrg.flatMap(({ projects }) => projects.map(p => p.id)))

      return NextResponse.json({
        installations: perOrg.map(({ org, projects }) => ({
          installationId: org.id,
          accountLogin: org.accountLogin,
          projects: projects.map(p => ({
            nodeId: p.id,
            number: p.number,
            title: p.title,
            url: p.url,
            closed: p.closed,
            itemCount: p.items.totalCount,
            updatedAt: p.updatedAt,
            boundProjectId: boardFor.get(p.id) ?? null,
          })),
        })),
      })
    } catch (err) {
      const mapped = githubErrorResponse(err)
      if (mapped) return mapped
      throw err
    }
  },
)
