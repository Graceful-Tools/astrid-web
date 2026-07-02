import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEventToUser } from '@/lib/sse-utils'
import { verifyWebhookSignature } from '@/lib/sync/github'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks.github-issues')

/**
 * POST /api/webhooks/github-issues — GitHub issues webhook.
 * NOT a sync engine: verifies the signature, finds users linked to the repo,
 * and nudges their clients over SSE (external_sync_refresh) to pull.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  const event = request.headers.get('x-github-event')
  if (event !== 'issues' && event !== 'issue_comment') {
    return NextResponse.json({ ok: true, ignored: event })
  }
  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 })
  }
  const repo = payload?.repository?.full_name as string | undefined
  if (!repo) return NextResponse.json({ ok: true })

  const links = await prisma.externalListLink.findMany({
    where: { provider: 'GITHUB_ISSUES', remoteContainerId: repo },
    select: { userId: true, id: true },
  })
  const userIds = [...new Set(links.map(l => l.userId))]
  for (const userId of userIds) {
    sendEventToUser(userId, {
      type: 'external_sync_refresh',
      data: { provider: 'GITHUB_ISSUES', container: repo },
    } as any)
  }
  log.info({ repo, users: userIds.length, event }, 'GitHub issues webhook → SSE nudge')
  return NextResponse.json({ ok: true, nudged: userIds.length })
}
