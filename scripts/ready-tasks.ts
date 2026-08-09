/**
 * Print the tasks currently in the **Ready** list on the Astrid Web To-do.
 *
 * Written for the `/fixall` loop. The loop previously had to call
 * `get-astrid-tasks` and then one `analyze-task` PER TASK just to read list
 * membership, which the list script does not print — six requests to discover
 * that there is nothing to do. `GET /api/v1/tasks?listId=` filters server-side,
 * so the whole check is one call.
 *
 * Exits 0 with "READY_EMPTY" when there is nothing queued, so a scheduled run
 * can stop without parsing anything.
 *
 *   npx tsx scripts/ready-tasks.ts
 */

// `export {}` makes this a module. Without it the file shares the global
// scope with every other script and `main` collides at typecheck time.
export {}

const READY_LIST_NAME = "Ready"

async function main() {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error("❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local")
    process.exit(1)
  }

  const tokenResponse = await fetch("https://astrid.cc/api/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!tokenResponse.ok) {
    console.error("❌ Failed to obtain access token:", await tokenResponse.text())
    process.exit(1)
  }

  const { access_token: token } = await tokenResponse.json()
  const auth = { "X-OAuth-Token": token }

  // Resolve Ready by NAME rather than hardcoding its id: the id is account
  // data, and a hardcoded one fails silently by returning an empty list, which
  // reads exactly like "nothing to do".
  const listsResponse = await fetch("https://astrid.cc/api/v1/lists", { headers: auth })
  const listsBody = await listsResponse.json()
  const lists = listsBody.lists ?? listsBody
  const ready = (Array.isArray(lists) ? lists : []).find(
    (list: { name?: string }) => list.name === READY_LIST_NAME,
  )

  if (!ready) {
    console.error(`❌ No list named "${READY_LIST_NAME}" found — check the account, not the queue.`)
    process.exit(1)
  }

  const tasksResponse = await fetch(
    `https://astrid.cc/api/v1/tasks?listId=${ready.id}&completed=false&limit=100`,
    { headers: auth },
  )
  const tasksBody = await tasksResponse.json()
  const tasks = tasksBody.tasks ?? tasksBody

  if (!Array.isArray(tasks) || tasks.length === 0) {
    console.log("READY_EMPTY")
    return
  }

  // Priority high → low, then oldest first — the order /fixall works them in.
  const queue = [...tasks].sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  console.log(`READY (${queue.length}):`)
  for (const task of queue) {
    const stars = "★".repeat(task.priority ?? 0) || "—"
    console.log(`  ${task.id}  ${stars.padEnd(3)}  ${task.title}`)
  }
}

main().catch(error => {
  console.error("❌ ready-tasks failed:", error)
  process.exit(1)
})
