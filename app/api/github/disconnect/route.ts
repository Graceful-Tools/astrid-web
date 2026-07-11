/**
 * Disconnect GitHub Installation API
 * Disconnects a specific GitHub App installation from the user
 * Accepts optional installationId to disconnect specific installation
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.disconnect')


export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body for optional installationId
    let installationId: number | undefined
    try {
      const body = await request.json()
      installationId = body.installationId ? parseInt(body.installationId) : undefined
    } catch {
      // No body or invalid JSON, disconnect all (backward compatible)
    }

    if (installationId) {
      // Disconnect specific installation
      const deletedIntegration = await prisma.gitHubIntegration.delete({
        where: {
          userId_installationId: {
            userId: session.user.id,
            installationId
          }
        }
      })

      return NextResponse.json({
        success: true,
        message: 'GitHub installation disconnected successfully',
        previousInstallationId: deletedIntegration.installationId
      })
    } else {
      // Disconnect all installations for this user (backward compatible)
      const deleted = await prisma.gitHubIntegration.deleteMany({
        where: { userId: session.user.id }
      })

      return NextResponse.json({
        success: true,
        message: `Disconnected ${deleted.count} GitHub installation(s)`,
        count: deleted.count
      })
    }

  } catch (error) {
    log.error({ err: error }, 'Error disconnecting GitHub installation:')

    // Check if the error is because no integration exists
    if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
      return NextResponse.json({
        success: true,
        message: 'No GitHub integration found to disconnect'
      })
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}