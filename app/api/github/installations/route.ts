/**
 * GitHub Installations API
 * Returns the current user's linked GitHub installations.
 *
 * Security: a user sees only installations linked to them, and links are made
 * only after GitHub confirms the user can see the installation (AWTD-1087).
 */

import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { App } from '@octokit/app'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('github.installations')


export async function GET(request: NextRequest) {
  // A deployment without the coding agent must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('codingAgent')
  if (capabilityBlocked) return capabilityBlocked

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
      // Every linked installation was uninstalled on GitHub: same as none linked.
    }

    // No linked installation. Installations of the App that nobody has linked
    // are NOT offered here: "unclaimed" is not "yours", and listing them handed
    // every signed-in user every org's installation to claim (AWTD-1087).
    // Linking goes through /api/github/setup, which asks GitHub to prove access.
    return NextResponse.json({
      installations: [],
      detectedInstallations: [],
      message: `No GitHub installation connected. Install the ${BRAND.appName} Agent on GitHub first.`
    })

  } catch (error) {
    log.error({ err: error }, 'Error fetching GitHub installations:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}