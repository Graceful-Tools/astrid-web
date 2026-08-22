/**
 * Print the tasks currently in the **Ready** state on the Astrid board.
 *
 * Written for the `/fixall` loop. The loop previously had to call
 * `get-astrid-tasks` and then one `analyze-task` PER TASK just to read list
 * membership, which the list script does not print — six requests to discover
 * that there is nothing to do. `GET /api/v1/tasks?listId=` filters server-side,
 * so the whole check is one call.
 *
 * Takes a board: `ready-tasks.ts` (web, default) or `ready-tasks.ts ios`. Both
 * loops share it so neither can drift from the other's guarantees.
 *
 * A task qualifies only when BOTH are true:
 * - It is on the selected board (Astrid Web To-do / Astrid iOS To-do)
 * - Its `statusRole` is `ready`
 *
 * Exits 0 with "READY_EMPTY" when there is nothing queued, so a scheduled run
 * can stop without parsing anything.
 *
 *   npx tsx scripts/ready-tasks.ts
 */

// `export {}` makes this a module. Without it the file shares the global
// scope with every other script and `main` collides at typecheck time.
export {}

import {
  isClaimableByAgent,
  describeAssignee,
  type AssignableTask,
} from "@/lib/ready-queue-scope"

/**
 * Which board to scope to. Both loops use this script so that the guarantees
 * are the same for each — ready-state on board, assigned-to-Claude only, loud failure on
 * a missing list, and a printed reason for everything skipped. A second copy of
 * this for iOS would drift, and the drift would be silent: a queue that is
 * wrong in this script looks exactly like a quiet day.
 *
 *   npx tsx scripts/ready-tasks.ts        # web (default)
 *   npx tsx scripts/ready-tasks.ts ios
 */
const BOARDS: Record<string, string> = {
  web: "Astrid Web To-do",
  ios: "Astrid iOS To-do",
}

const boardArg = (process.argv[2] || "web").toLowerCase()
const BOARD_LIST_NAME = BOARDS[boardArg]

if (!BOARD_LIST_NAME) {
  console.error(`❌ Unknown board "${boardArg}". Expected one of: ${Object.keys(BOARDS).join(", ")}`)
  process.exit(1)
}

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

  // Resolve the board list by NAME rather than hardcoding its id: an id is
  // account data, and a hardcoded one fails silently by returning an empty
  // list, which reads exactly like "nothing to do".
  const listsResponse = await fetch("https://astrid.cc/api/v1/lists", { headers: auth })
  const listsBody = await listsResponse.json()
  const lists = listsBody.lists ?? listsBody
  const byName = (name: string) =>
    (Array.isArray(lists) ? lists : []).find((list: { name?: string }) => list.name === name)

  const board = byName(BOARD_LIST_NAME)

  // Fail loudly on a missing board list instead of degrading to an empty queue.
  // Skipping the board filter would silently widen this to every board.
  if (!board) {
    console.error(`❌ No list named "${BOARD_LIST_NAME}" found — refusing to run unscoped.`)
    process.exit(1)
  }

  const tasksResponse = await fetch(
    `https://astrid.cc/api/v1/tasks?listId=${board.id}&completed=false&limit=100`,
    { headers: auth },
  )
  const tasksBody = await tasksResponse.json()
  const tasks = tasksBody.tasks ?? tasksBody
  const all = Array.isArray(tasks) ? tasks : []

  // Keep only tasks currently in the ready state.
  const isReady = (task: { statusRole?: string | null }) =>
    (task.statusRole ?? "").toLowerCase() === "ready"
  const readyNow = all.filter(isReady)
  const notReady = all.filter(task => !isReady(task))

  // ...and assigned to Claude.
  //
  // An assignee is a claim. A task assigned to a person is that person's, even
  // when it sits in Ready — the loop picking it up means two people writing the
  // same fix, or Jon's own in-progress work being redone underneath him. Ready
  // says "this is actionable", not "this is unclaimed", so the two conditions
  // are separate and both are required.
  const mine = readyNow.filter((task: AssignableTask) => isClaimableByAgent(task))
  const claimed = readyNow.filter((task: AssignableTask) => !isClaimableByAgent(task))

  // Print what was filtered out. Silently dropping non-ready tasks would make a
  // board with lots of backlog look identical to a truly empty ready queue.
  if (notReady.length > 0) {
    console.log(`(${notReady.length} task(s) on ${BOARD_LIST_NAME} not in Ready state — ignored:)`)
    for (const task of notReady) {
      console.log(`  — ${task.title}`)
    }
  }

  // Same reasoning as above: a queue held up by work the loop may not take must not
  // look like an idle one. Naming the assignee is what lets Jon see whether it is
  // waiting on a person or simply waiting to be handed something.
  //
  // The wording covers BOTH reasons now. Since assignment became the handshake,
  // "unassigned" is the common case, and calling that "assigned to someone else"
  // was plainly wrong — it read as a claim by a person who did not exist.
  if (claimed.length > 0) {
    const unassigned = claimed.filter(task => !task.assigneeId).length
    const reason =
      unassigned === claimed.length ? 'not assigned to this loop'
      : unassigned === 0 ? 'assigned to someone else'
      : `${unassigned} unassigned, ${claimed.length - unassigned} assigned to someone else`
    console.log(`(${claimed.length} Ready task(s) — ${reason}:)`)
    for (const task of claimed) {
      const who = describeAssignee(task)
      console.log(`  — ${task.title}  [${who}]`)
    }
  }

  if (mine.length === 0) {
    console.log("READY_EMPTY")
    return
  }

  // Priority high → low, then oldest first — the order /fixall works them in.
  const queue = [...mine].sort((a, b) => {
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
