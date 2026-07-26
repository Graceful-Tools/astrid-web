#!/usr/bin/env npx tsx

/**
 * One-off cleanup for the "Google backfill imported completed tasks as open"
 * bug (iOS temp-task completion never reached the server).
 *
 * For every Google Tasks task-link in the user's DEFAULT tasklist (My Tasks),
 * if the Google side is completed but the Astrid task is still open, complete
 * the Astrid task with the backdated Google completion time and
 * completedSource=google — exactly what the device drift repair does.
 *
 * Usage:
 *   npx tsx scripts/cleanup-google-backfill-open-tasks.ts          # dry run
 *   npx tsx scripts/cleanup-google-backfill-open-tasks.ts --apply  # fix
 *
 * --complete-remote-stale: additionally complete (on BOTH sides, backdated)
 * linked pairs that are OPEN on Google but haven't been touched there since
 * before 2024 — ancient Todoroo/Astrid.com-era leftovers that flood My Tasks.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const BASE = 'https://astrid.cc'
const APPLY = process.argv.includes('--apply')

async function main() {
  const tokenResponse = await fetch(`${BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.ASTRID_OAUTH_CLIENT_ID,
      client_secret: process.env.ASTRID_OAUTH_CLIENT_SECRET,
      scope: 'tasks:read tasks:write',
    }),
  })
  if (!tokenResponse.ok) throw new Error(`token: ${tokenResponse.status} ${await tokenResponse.text()}`)
  const { access_token } = await tokenResponse.json()
  const headers = { 'X-OAuth-Token': access_token, 'Content-Type': 'application/json' }

  const tl = await fetch(`${BASE}/api/v1/sync/google/tasklists`, { headers })
  if (!tl.ok) throw new Error(`tasklists: ${tl.status} ${await tl.text()}`)
  const { defaultId } = await tl.json()
  if (!defaultId) throw new Error('no default tasklist id')
  console.log(`Default tasklist: ${defaultId}`)

  const remoteRes = await fetch(`${BASE}/api/v1/sync/google/tasks?tasklistId=${encodeURIComponent(defaultId)}`, { headers })
  if (!remoteRes.ok) throw new Error(`remote pull: ${remoteRes.status} ${await remoteRes.text()}`)
  const { items, truncated } = await remoteRes.json()
  console.log(`Remote items: ${items.length}${truncated ? ' (TRUNCATED — rerun after)' : ''}`)
  const remoteById = new Map<string, any>(items.map((i: any) => [i.remoteId, i]))

  const linksRes = await fetch(`${BASE}/api/v1/sync/google/task-links?containerId=${encodeURIComponent(defaultId)}`, { headers })
  if (!linksRes.ok) throw new Error(`task-links: ${linksRes.status} ${await linksRes.text()}`)
  const { links } = await linksRes.json()
  console.log(`Task links in default tasklist: ${links.length}`)

  const STALE_MODE = process.argv.includes('--complete-remote-stale')
  const STALE_CUTOFF = '2025-01-01T00:00:00Z'

  let fixed = 0, alreadyOk = 0, openBothSides = 0, missing = 0, staled = 0
  for (const link of links) {
    const remote = remoteById.get(link.remoteId)
    if (!remote || remote.metadata?.deleted === '1') { missing++; continue }
    if (!remote.completed) {
      const stale = !!remote.dueDate && remote.dueDate < STALE_CUTOFF
      if (!STALE_MODE || !stale) {
        openBothSides++
        continue
      }
      // Ancient + open on Google: complete both sides, backdated to the last
      // remote touch so it stays out of every recently-completed window.
      staled++
      console.log(`${APPLY ? 'COMPLETING (stale)' : 'would complete (stale)'}: "${remote.title}" — last touched ${remote.remoteUpdatedAt}`)
      if (APPLY) {
        const patch = await fetch(`${BASE}/api/v1/sync/google/tasks`, {
          method: 'POST', headers,
          body: JSON.stringify({ tasklistId: defaultId, remoteId: link.remoteId, completed: true }),
        })
        if (!patch.ok) { console.error(`  Google PATCH failed: ${patch.status} ${await patch.text()}`); continue }
        const put = await fetch(`${BASE}/api/v1/tasks/${link.astridTaskId}`, {
          method: 'PUT', headers,
          body: JSON.stringify({ completed: true, completedAt: remote.remoteUpdatedAt, completedSource: 'google' }),
        })
        if (!put.ok) console.error(`  Astrid PUT failed: ${put.status} ${await put.text()}`)
      }
      continue
    }

    const taskRes = await fetch(`${BASE}/api/v1/tasks/${link.astridTaskId}`, { headers })
    if (!taskRes.ok) { missing++; continue }
    const taskJson = await taskRes.json()
    const task = taskJson.task ?? taskJson
    if (task.completed) { alreadyOk++; continue }

    fixed++
    console.log(`${APPLY ? 'FIXING' : 'would fix'}: "${task.title}" (${link.astridTaskId}) — Google completed ${remote.completedAt ?? ''}`)
    if (APPLY) {
      const put = await fetch(`${BASE}/api/v1/tasks/${link.astridTaskId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          completed: true,
          completedAt: remote.completedAt ?? remote.remoteUpdatedAt,
          completedSource: 'google',
        }),
      })
      if (!put.ok) console.error(`  PUT failed: ${put.status} ${await put.text()}`)
    }
  }

  // Unlinked strays: the backfill created the Astrid twin but the link upsert
  // failed, so the completion (also dropped by the temp-update bug) never
  // synced and drift repair can't see it. Match by title against COMPLETED
  // remote items and complete the stray backdated.
  const openRes = await fetch(`${BASE}/api/v1/tasks?completed=false&limit=1000`, { headers })
  const openTasks = ((await openRes.json()).tasks ?? []) as any[]
  const linkedIds = new Set(links.map((l: any) => l.astridTaskId))
  const completedRemoteByTitle = new Map(
    items.filter((i: any) => i.completed && i.metadata?.deleted !== '1').map((i: any) => [i.title, i]))
  let strays = 0
  for (const task of openTasks) {
    if ((task.listIds ?? []).length || linkedIds.has(task.id)) continue
    if ((task.createdAt ?? '') < '2026-07-03') continue  // only sync-created rows
    const remote = completedRemoteByTitle.get(task.title) as any
    if (!remote) continue
    strays++
    console.log(`${APPLY ? 'FIXING stray' : 'would fix stray'}: "${task.title}" (${task.id}) — Google completed ${remote.completedAt ?? ''}`)
    if (APPLY) {
      const put = await fetch(`${BASE}/api/v1/tasks/${task.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ completed: true, completedAt: remote.completedAt ?? remote.remoteUpdatedAt, completedSource: 'google' }),
      })
      if (!put.ok) console.error(`  PUT failed: ${put.status} ${await put.text()}`)
    }
  }

  console.log(`\n${APPLY ? 'Fixed' : 'Would fix'}: ${fixed}`)
  console.log(`${APPLY ? 'Fixed strays' : 'Would fix strays'}: ${strays}`)
  if (STALE_MODE) console.log(`${APPLY ? 'Completed stale (both sides)' : 'Would complete stale'}: ${staled}`)
  console.log(`Already completed in Astrid: ${alreadyOk}`)
  console.log(`Open on both sides (correct): ${openBothSides}`)
  console.log(`Remote missing/deleted or task gone: ${missing}`)
  if (!APPLY && fixed > 0) console.log('\nRe-run with --apply to fix.')
}

main().catch(e => { console.error(e); process.exit(1) })
