/**
 * GitHub Installations API
 * Returns the current user's connected GitHub installation
 * OR detects unlinked installations from GitHub API when user has no DB record
 *
 * Security: Each user only sees their own installation or available unlinked installations
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { App } from '@octokit/app'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.installations')


export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if GitHub App is configured
    if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
      return NextResponse.json({
        installations: [],
        detectedInstallations: [],
        message: 'GitHub App not configured. Please set up environment variables.'
      })
    }

    // Get all of the user's GitHub integrations
    const userIntegrations = await prisma.gitHubIntegration.findMany({
      where: { userId: session.user.id }
    })

    // Initialize GitHub App
    const app = new App({
      appId: parseInt(process.env.GITHUB_APP_ID),
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY
    })

    // If user has linked integrations, fetch them from GitHub
    const linkedIntegrations = userIntegrations.filter(i => i.installationId)
    if (linkedIntegrations.length > 0) {
      const validInstallations: any[] = []

      // Fetch each installation from GitHub
      for (const integration of linkedIntegrations) {
        try {
          const installation = await app.octokit.request('GET /app/installations/{installation_id}', {
            installation_id: integration.installationId!
          })

          const account = installation.data.account as any
          validInstallations.push({
            id: installation.data.id,
            account: {
              login: account?.login || account?.name || 'unknown',
              avatar_url: account?.avatar_url || ''
            },
            target_type: installation.data.target_type,
            created_at: installation.data.created_at,
            updated_at: installation.data.updated_at
          })
        } catch (installationError: any) {
          // Installation might have been removed from GitHub
          if (installationError.status === 404) {
            log.info(`Installation ${integration.installationId} not found on GitHub - may have been uninstalled`)
          } else {
            throw installationError
          }
        }
      }

      if (validInstallations.length > 0) {
        return NextResponse.json({
          installations: validInstallations,
          detectedInstallations: [],
          message: `Found ${validInstallations.length} connected installation(s)`
        })
      }
      // All installations were invalid, fall through to detect available installations
    }

    // User has no linked integration (or it was uninstalled)
    // Detect available installations from GitHub API
    try {
      // Get all installations of this GitHub App
      const allInstallations = await app.octokit.request('GET /app/installations')

      // Get all installation IDs already connected to other users
      const connectedInstallations = await prisma.gitHubIntegration.findMany({
        where: {
          userId: { not: session.user.id },
          installationId: { not: null }
        },
        select: { installationId: true }
      })
      const connectedIds = new Set(connectedInstallations.map(i => i.installationId))

      // Filter to only show installations not connected to other users
      const availableInstallations = allInstallations.data.filter(
        (inst: any) => !connectedIds.has(inst.id)
      )

      // Transform for the UI
      const detectedInstallations = availableInstallations.map((inst: any) => {
        const account = inst.account as any
        return {
          id: inst.id,
          account: {
            login: account?.login || account?.name || 'unknown',
            avatar_url: account?.avatar_url || ''
          },
          target_type: inst.target_type,
          created_at: inst.created_at,
          updated_at: inst.updated_at
        }
      })

      if (detectedInstallations.length > 0) {
        return NextResponse.json({
          installations: [],
          detectedInstallations,
          message: `Found ${detectedInstallations.length} available GitHub installation(s). Click "Connect" to link one to your account.`
        })
      }

      return NextResponse.json({
        installations: [],
        detectedInstallations: [],
        message: 'No GitHub installation connected. Install the Astrid Agent on GitHub first.'
      })

    } catch (detectError: any) {
      log.error({ err: detectError }, 'Error detecting GitHub installations:')
      return NextResponse.json({
        installations: [],
        detectedInstallations: [],
        message: 'No GitHub installation connected. Install the Astrid Agent on GitHub first.'
      })
    }

  } catch (error) {
    log.error({ err: error }, 'Error fetching GitHub installations:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}