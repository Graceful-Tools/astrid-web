#!/usr/bin/env npx tsx
/**
 * File one Inbox task for the board's owner when a cloud run cannot authenticate its harness
 * (ADEV-236). agent-run.yml calls this from slot 1 when "Check the Claude Code token" fails.
 *
 * Why a task and not list chat: a task assigned to a person notifies them, list chat notifies
 * nobody. One open task at a time: a run every half hour must not file forty-eight a day.
 *
 * Usage: npx tsx scripts/report-harness-auth-failure.ts --list <boardId> --run-url <url> --repo <owner/name>
 */
import { loadScriptEnv } from './lib/load-env'
import { boardTasksUrl } from './lib/board-read-url'
import { scriptApiOrigin } from './lib/script-client'
import { RENEW_TOKEN_TITLE, openRenewalTask, renewalDescription } from './lib/harness-start'

loadScriptEnv()

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const listId = arg('--list')
  const runUrl = arg('--run-url') ?? '(run URL unknown)'
  const repo = arg('--repo') ?? 'Graceful-Tools/astrid-web'
  if (!listId) throw new Error('Usage: report-harness-auth-failure.ts --list <boardId> --run-url <url> --repo <owner/name>')

  const api = scriptApiOrigin()
  const tokenResponse = await fetch(`${api}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
    }),
  })
  if (!tokenResponse.ok) throw new Error(`OAuth token request failed: HTTP ${tokenResponse.status}`)
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string }
  const auth = { 'X-OAuth-Token': token }

  const boardResponse = await fetch(boardTasksUrl({ boardId: listId, limit: 500, origin: api }), { headers: auth })
  if (!boardResponse.ok) throw new Error(`Board read failed: HTTP ${boardResponse.status}`)
  const boardBody = (await boardResponse.json()) as { tasks?: unknown[] } | unknown[]
  const tasks = (Array.isArray(boardBody) ? boardBody : boardBody.tasks ?? []) as Array<{
    identifier?: string | null
    title?: string | null
    completed?: boolean
  }>
  const open = openRenewalTask(tasks)
  if (open) {
    console.log(`AUTH: renewal task already open (${open.identifier ?? open.title}); not filing another`)
    return
  }

  const listsResponse = await fetch(`${api}/api/v1/lists`, { headers: auth })
  if (!listsResponse.ok) throw new Error(`List read failed: HTTP ${listsResponse.status}`)
  const listsBody = (await listsResponse.json()) as { lists?: unknown[] } | unknown[]
  const lists = (Array.isArray(listsBody) ? listsBody : listsBody.lists ?? []) as Array<{ id: string; ownerId?: string }>
  const ownerId = lists.find(list => list.id === listId)?.ownerId
  if (!ownerId) throw new Error('Board owner not found; cannot assign the renewal task')

  const created = await fetch(`${api}/api/v1/tasks`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: RENEW_TOKEN_TITLE,
      description: renewalDescription({ runUrl, repo }),
      listIds: [listId],
      priority: 3,
      assigneeId: ownerId,
      statusRole: null,
    }),
  })
  if (!created.ok) throw new Error(`Filing the renewal task failed: HTTP ${created.status}`)
  const body = (await created.json()) as { task?: { identifier?: string } }
  console.log(`AUTH: filed ${body.task?.identifier ?? 'the renewal task'} in the owner's Inbox`)
}

main().catch(error => {
  console.error(`report-harness-auth-failure failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
