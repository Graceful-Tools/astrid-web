/**
 * GitHub App Installation URL endpoint
 */

import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.install-url')


export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const appId = process.env.GITHUB_APP_ID
    if (!appId) {
      return NextResponse.json({ error: 'GitHub App not configured' }, { status: 500 })
    }

    // Create installation URL with state parameter to track user
    const state = Buffer.from(JSON.stringify({
      userId: session.user.id,
      timestamp: Date.now()
    })).toString('base64')

    // Use the actual GitHub App name from your GitHub App settings
    const appName = BRAND.githubAppSlug // The registered GitHub App backing the coding agent
    const installUrl = `https://github.com/apps/${appName}/installations/new?state=${state}`

    return NextResponse.json({ installUrl })

  } catch (error) {
    log.error({ err: error }, 'Error generating install URL:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}