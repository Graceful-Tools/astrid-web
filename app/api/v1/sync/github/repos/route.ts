import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { githubRequest, githubTokenFor } from '@/lib/sync/github'

/** GET /api/v1/sync/github/repos — the caller's repos (remote containers). */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.sync.github' },
  async (_req, auth) => {
    const token = await githubTokenFor(auth.userId)
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 401 })
    const { status, json } = await githubRequest(
      token, 'GET', '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator'
    )
    if (status !== 200) return NextResponse.json({ error: 'GitHub error', detail: json }, { status: 502 })
    const repos = (json as any[]).map(r => ({ id: r.full_name, name: r.full_name, private: r.private }))
    return NextResponse.json({ repos })
  }
)
