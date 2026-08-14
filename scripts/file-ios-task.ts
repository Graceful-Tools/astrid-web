/**
 * File a task on the Astrid iOS To-do board, by list NAME.
 *
 *   npx tsx scripts/file-ios-task.ts "<title>" "<description>" [-p 0-3] [--dry-run]
 *
 * Written for the `/fixall` and `/fixstuff` loops running against astrid-web.
 * Those loops may only edit this repo, so any fix that needs a Swift change has
 * to be handed to the board whose loop can work it. Until now the docs said
 * "file the iOS companion" without naming a command, and the only iOS-creating
 * script was `create-ios-tasks.ts`, which takes a JSON file and writes through
 * Prisma with a PRODUCTION DATABASE_URL. That is a heavy, risky tool to reach
 * for when you want to file one follow-up.
 *
 * This one goes through the OAuth API instead — same path as
 * `move-task-to-list.ts`, and no direct production database access.
 *
 * It borrows that script's hard-won failure mode: resolve the list by NAME and
 * fail loudly if it is missing, rather than writing with an id that turns out
 * to be undefined. A create with `listIds: [undefined]` would land a task on no
 * board at all, which looks like success and is invisible until someone goes
 * looking for a companion that was never filed.
 *
 * It also refuses to file a duplicate title that is already open on the board,
 * because these loops re-run on a schedule and would otherwise file the same
 * companion every pass.
 */

export {}

const ASTRID_API_BASE = process.env.ASTRID_API_BASE || 'https://astrid.cc'
const IOS_LIST_NAME = process.env.ASTRID_IOS_LIST_NAME || 'Astrid iOS To-do'

function parseArgs() {
  const args = process.argv.slice(2)
  let priority = 1
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--priority' || args[i] === '-p') && args[i + 1]) {
      priority = parseInt(args[i + 1], 10)
      args.splice(i, 2)
      i--
    } else if (args[i] === '--dry-run') {
      dryRun = true
      args.splice(i, 1)
      i--
    }
  }

  return { title: args[0] || '', description: args[1] || '', priority, dryRun }
}

async function main() {
  const { title, description, priority, dryRun } = parseArgs()

  if (!title) {
    console.error('Usage: npx tsx scripts/file-ios-task.ts "<title>" ["<description>"] [-p 0-3] [--dry-run]')
    process.exit(1)
  }

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local')
    process.exit(1)
  }

  const tokenResponse = await fetch(`${ASTRID_API_BASE}/api/v1/oauth/token`, {
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

  // Resolve by name. If the board has been renamed, say so and write nothing —
  // a missing board must never degrade into "filed somewhere".
  const listsResponse = await fetch(`${ASTRID_API_BASE}/api/v1/lists`, { headers: auth })
  const listsBody = await listsResponse.json()
  const lists = listsBody.lists ?? listsBody
  const target = (Array.isArray(lists) ? lists : []).find(
    (list: { name?: string }) => list.name === IOS_LIST_NAME,
  )

  if (!target) {
    console.error(`❌ No list named "${IOS_LIST_NAME}". Nothing written.`)
    console.error('   Available:', (Array.isArray(lists) ? lists : []).map((l: { name?: string }) => l.name).join(' | '))
    process.exit(1)
  }

  // Duplicate guard: these loops re-run on a schedule.
  const existingResponse = await fetch(
    `${ASTRID_API_BASE}/api/v1/tasks?listId=${target.id}&completed=false&limit=200`,
    { headers: auth },
  )
  if (existingResponse.ok) {
    const existingBody = await existingResponse.json()
    const existing = existingBody.tasks ?? existingBody.data ?? []
    const clash = (Array.isArray(existing) ? existing : []).find(
      (t: { title?: string }) => (t.title ?? '').trim().toLowerCase() === title.trim().toLowerCase(),
    )
    if (clash) {
      console.log(`⏭️  Already open on ${IOS_LIST_NAME}: "${title}"`)
      console.log(`   Task ID: ${clash.id} — nothing written.`)
      return
    }
  }

  if (dryRun) {
    console.log(`🔎 dry run — would file on "${IOS_LIST_NAME}" (${target.id}):`)
    console.log(`   title:    ${title}`)
    console.log(`   priority: ${priority}`)
    console.log(`   description: ${description ? `${description.slice(0, 80)}…` : '(none)'}`)
    return
  }

  const response = await fetch(`${ASTRID_API_BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title, description, priority, listIds: [target.id] }),
  })

  if (!response.ok) {
    console.error(`❌ Failed to create task: ${response.status}`, await response.text())
    process.exit(1)
  }

  const { task } = await response.json()
  console.log(`✅ Filed on ${IOS_LIST_NAME}`)
  console.log(`   Task ID:  ${task.id}`)
  console.log(`   Title:    ${task.title}`)
  // Read the memberships back: a task that landed on no board looks like
  // success from the POST alone.
  console.log(`   Lists:    ${(task.lists ?? []).map((l: { name?: string }) => l.name).join(', ') || '(none — investigate)'}`)
}

main().catch((error) => {
  console.error('❌ Error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
