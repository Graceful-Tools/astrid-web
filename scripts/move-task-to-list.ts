/**
 * Move a task to a different list, by list NAME.
 *
 *   npx tsx scripts/move-task-to-list.ts <taskId> "Astrid iOS To-do"
 *
 * Written for the `/fixall` loop, which needs to route a platform-tagged task
 * off the web board to the board whose loop can actually work it.
 *
 * It exists as a script rather than an ad-hoc snippet because the ad-hoc
 * version went wrong once: `GET /api/v1/tasks/[id]` returns `{ task, meta }`,
 * so reading `body.lists` yields undefined, a "keep everything except X" filter
 * computes an empty array, and the PUT strips EVERY membership — the task falls
 * off all boards at once. So this one:
 *
 *   - resolves the target list by name and fails loudly if it does not exist,
 *     rather than PUTing an id that turns out to be undefined
 *   - unwraps the `{ task }` envelope explicitly
 *   - reads the task back afterwards and prints the memberships, so a silent
 *     wrong write is visible immediately
 */

export {}

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

async function main() {
  const [taskId, targetListName] = process.argv.slice(2)

  if (!taskId || !targetListName) {
    console.error('Usage: npx tsx scripts/move-task-to-list.ts <taskId> "<list name>"')
    process.exit(1)
  }

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local')
    process.exit(1)
  }

  const tokenResponse = await fetch('https://astrid.cc/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  })
  if (!tokenResponse.ok) {
    console.error('❌ Failed to obtain access token:', await tokenResponse.text())
    process.exit(1)
  }
  const { access_token: token } = await tokenResponse.json()
  const auth = { 'X-OAuth-Token': token, 'Content-Type': 'application/json' }

  const listsResponse = await fetch('https://astrid.cc/api/v1/lists', { headers: auth })
  const listsBody = await listsResponse.json()
  const lists = listsBody.lists ?? listsBody
  const target = (Array.isArray(lists) ? lists : []).find(
    (list: { name?: string }) => list.name === targetListName,
  )

  if (!target) {
    console.error(`❌ No list named "${targetListName}". Nothing written.`)
    console.error('   Available:', (Array.isArray(lists) ? lists : []).map((l: any) => l.name).join(' | '))
    process.exit(1)
  }

  const before = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, { headers: auth })
  const beforeBody = await before.json()
  const beforeTask = beforeBody.task ?? beforeBody
  if (!beforeTask?.id) {
    console.error('❌ Task not found:', taskId)
    process.exit(1)
  }
  console.log('before:', JSON.stringify((beforeTask.lists || []).map((l: any) => l.name)))

  const put = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ listIds: [target.id] }),
  })
  if (!put.ok) {
    console.error('❌ Move failed:', put.status, await put.text())
    process.exit(1)
  }

  // Read back rather than trusting the write: a wrong membership is the whole
  // failure mode this script exists to prevent.
  const after = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, { headers: auth })
  const afterBody = await after.json()
  const afterTask = afterBody.task ?? afterBody
  const names = (afterTask.lists || []).map((l: any) => l.name)
  console.log('after: ', JSON.stringify(names))

  if (!names.includes(targetListName)) {
    console.error(`❌ Task is NOT on "${targetListName}" after the move — check it by hand.`)
    process.exit(1)
  }
  console.log(`✅ Moved to "${targetListName}"`)
}

main().catch(error => {
  console.error('❌ move-task-to-list failed:', error)
  process.exit(1)
})
