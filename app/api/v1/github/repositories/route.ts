/**
 * GitHub Repositories API (v1 - Mobile Compatible)
 * Returns user's accessible GitHub repositories
 *
 * The listing rule lives in lib/github-repositories.ts and is shared with the
 * legacy route. This handler owns only the withAuth wrapper: OAuth/session
 * auth, the `user:read` scope check, and standardized errors.
 *
 * This response carries no `meta` envelope and never has — it is identical to
 * the legacy one. The routes stay separate because their auth differs.
 * (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { listGitHubRepositories } from '@/lib/github-repositories'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.github.repositories' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const refresh = searchParams.get('refresh') === 'true'

    const result = await listGitHubRepositories({ userId: auth.userId, refresh })

    return NextResponse.json(result)
  }
)
