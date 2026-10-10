import { type NextRequest, NextResponse } from 'next/server'
import { nudgeIssuesSubscribers } from '@/lib/github/webhooks/issues'
import { verifyWebhookSignature } from '@/lib/sync/github'
import { capabilityGate } from '@/lib/brand/capabilities'

/**
 * POST /api/webhooks/github-issues — the per-repo GitHub issues webhook.
 * NOT a sync engine: verifies the signature and nudges the clients of users
 * linked to the repo (lib/github/webhooks/issues.ts — the same nudge the
 * GitHub App's webhook now sends, AWTD-1113). Retire this route, and
 * GITHUB_SYNC_WEBHOOK_SECRET, once the App path has shipped and the repos'
 * hand-made hooks are removed.
 */
export async function POST(request: NextRequest) {
  // A deployment with the integration disabled must not keep syncing on the
  // server while the UI 404s. Gated before the signature check: with the
  // capability off there is nothing here to authenticate against
  // (task 229c175c).
  const blocked = capabilityGate('syncGithubIssues')
  if (blocked) return blocked

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

  const nudged = await nudgeIssuesSubscribers(repo, event)
  return NextResponse.json({ ok: true, nudged })
}
