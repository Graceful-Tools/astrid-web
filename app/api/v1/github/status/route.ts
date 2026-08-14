/**
 * GitHub Connection Status API (v1 - Mobile Compatible)
 * Checks if user has complete GitHub + AI setup
 *
 * The payload is built by lib/github-status.ts and shared with the legacy
 * route. This handler owns only the withAuth wrapper: OAuth/session auth, the
 * `user:read` scope check, and standardized errors.
 *
 * Note this response carries NO `meta` envelope, and never has — it is
 * byte-identical to the legacy one. The routes stay separate anyway because
 * their auth differs, and re-exporting would apply the scope check to legacy
 * callers. (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getGitHubStatus } from '@/lib/github-status'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.github.status' },
  async (_req, auth) => {
    const status = await getGitHubStatus(auth.userId, 'v1/github/status')
    return NextResponse.json(status)
  }
)
