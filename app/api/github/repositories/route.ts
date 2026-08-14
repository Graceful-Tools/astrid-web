/**
 * GitHub Repositories API (legacy)
 * Returns user's accessible GitHub repositories
 *
 * The listing rule lives in lib/github-repositories.ts and is shared with the
 * v1 route. This handler owns only session auth. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { listGitHubRepositories } from '@/lib/github-repositories'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.repositories')

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === 'true'

    const result = await listGitHubRepositories({ userId: session.user.id, refresh })

    return NextResponse.json(result)
  } catch (error) {
    log.error({ err: error }, 'Error fetching GitHub repositories:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
