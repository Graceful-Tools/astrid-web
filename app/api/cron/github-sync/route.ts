/**
 * GET /api/cron/github-sync — run a GitHub sync pass for every importing link.
 *
 * Task d8de37c1. Jon picked the server-side cron over building a second sync
 * client in TypeScript: it makes sync independent of whether any app is open,
 * instead of duplicating logic that already exists in Swift.
 *
 * WHAT THIS FIXES. lib/sync/github.ts says the CLIENT executes the sync, and
 * iOS is the only client that does. So "make sure task and issue descriptions
 * sync" is currently true only while someone has a phone open.
 *
 * The pass itself is in lib/sync/github/sync-all-links.ts — this route is auth
 * plus a call, so triggering a sync never has to go through HTTP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncAllGithubLinks } from '@/lib/sync/github/sync-all-links'
import { requireCronSecret } from '@/lib/cron-auth'
import { capabilityGate } from '@/lib/brand/capabilities'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  // A deployment that turned the GitHub integration off must not keep running
  // sync passes against its users' repositories (task 229c175c).
  const capabilityBlocked = capabilityGate('syncGithubIssues')
  if (capabilityBlocked) return capabilityBlocked

  // Fails CLOSED: no CRON_SECRET configured means nobody gets in.
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  const summary = await syncAllGithubLinks()
  return NextResponse.json({ ok: true, ...summary })
}
