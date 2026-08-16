/**
 * Assign a task to a person or an agent, by email.
 *
 *   npx tsx scripts/assign-task.ts <taskId> jonparis@gmail.com
 *   npx tsx scripts/assign-task.ts <taskId> claude@astrid.cc
 *
 * Written for the `/fixall` loops, which hand a task back to Jon when they need a
 * decision — assign to him and move it to Waiting, so the board says who is holding
 * it rather than leaving it to look abandoned in Ready.
 *
 * Distinct from `assign-to-agent.ts`, which only ever looks through the members of
 * `ASTRID_OAUTH_LIST_ID`. Jon OWNS the boards rather than appearing in their member
 * roster, so that lookup returns nothing for him and the assignment silently cannot
 * be made. This one searches the owner as well, and fails loudly when it cannot
 * resolve the person rather than PUTing an undefined assignee.
 */

export {}

const API = 'https://astrid.cc'

interface Person { id?: string; email?: string | null; name?: string | null }

/** Everyone this token can see on a list: its members and its owner. */
function peopleOn(list: Record<string, unknown>): Person[] {
  const members = (list.listMembers as Array<{ user?: Person }> | undefined) ?? []
  const found: Person[] = members.map(m => m.user).filter(Boolean) as Person[]
  for (const key of ['owner', 'user', 'createdBy']) {
    const candidate = list[key] as Person | undefined
    if (candidate?.email) found.push(candidate)
  }
  return found
}

async function main() {
  const [taskId, emailArg] = process.argv.slice(2)
  if (!taskId || !emailArg) {
    console.error('Usage: npx tsx scripts/assign-task.ts <taskId> <email>')
    process.exit(1)
  }
  const email = emailArg.toLowerCase()

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('❌ ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET missing from .env.local')
    process.exit(1)
  }

  const tokenResponse = await fetch(`${API}/api/v1/oauth/token`, {
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

  // Look on the task's OWN lists first — whoever we are assigning to has to be
  // someone that task's boards know about, and it avoids depending on one
  // configured list id being the right one.
  const taskResponse = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const taskBody = await taskResponse.json()
  const task = taskBody.task ?? taskBody
  if (!task?.id) {
    console.error('❌ Task not found:', taskId)
    process.exit(1)
  }

  // The task's own lists first, then the OAuth list. Agents are members of the
  // OAuth list but not of Jon's boards, so searching only the task's lists finds
  // Jon and never finds Claude — half a tool, and the half that fails is silent.
  const listIds: string[] = [
    ...(task.lists || []).map((l: { id: string }) => l.id),
    ...(process.env.ASTRID_OAUTH_LIST_ID ? [process.env.ASTRID_OAUTH_LIST_ID] : []),
  ]
  const searched: string[] = []
  let match: Person | undefined

  for (const listId of listIds) {
    const response = await fetch(`${API}/api/v1/lists/${listId}`, { headers: auth })
    if (!response.ok) continue
    const body = await response.json()
    const list = body.list ?? body
    searched.push(list?.name ?? listId)
    match = peopleOn(list).find(p => p.email?.toLowerCase() === email)
    if (match?.id) break
  }

  if (!match?.id) {
    console.error(`❌ No user with email "${emailArg}" on this task's lists. Nothing written.`)
    console.error('   Searched:', searched.join(' | ') || '(no lists on the task)')
    process.exit(1)
  }

  const put = await fetch(`${API}/api/v1/tasks/${taskId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ assigneeId: match.id }),
  })
  if (!put.ok) {
    console.error('❌ Assignment failed:', put.status, await put.text())
    process.exit(1)
  }

  // Read back: an assignment that did not stick looks identical to one that did.
  const after = await fetch(`${API}/api/v1/tasks/${taskId}`, { headers: auth })
  const afterTask = (await after.json()).task ?? {}
  if (afterTask.assigneeId !== match.id) {
    console.error(`❌ Assignee is "${afterTask.assigneeId}" after the write, expected "${match.id}".`)
    process.exit(1)
  }

  console.log(`✅ Assigned to ${match.name || match.email}`)
}

main().catch(error => {
  console.error('❌ assign-task failed:', error)
  process.exit(1)
})
