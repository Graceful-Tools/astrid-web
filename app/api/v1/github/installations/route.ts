/**
 * GitHub App installations the user can act on (AWTD-1114).
 *
 * Backs the GitHub card on Settings → Connections. Read from the installation
 * model (AWTD-1111): an installation appears only if the user has an access
 * row, which only GitHub's own answer grants.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { installationSummariesForUser } from '@/lib/github/installations'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.github.installations', capability: 'codingAgent' },
  async (_req, auth) => {
    const installations = await installationSummariesForUser(auth.userId)
    return NextResponse.json({ installations })
  }
)
