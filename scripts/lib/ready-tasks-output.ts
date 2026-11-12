/**
 * The machine form of `scripts/ready-tasks.ts --json`, read by
 * `.github/workflows/fixall.yml` through `scripts/parse-ready-tasks-output.ts`.
 *
 * Schema version 1 is unchanged: `{"version":1,"tasks":[{"id":"<uuid>","action":"ready"}]}`.
 * It used to carry `recheck` / `review` entries for the client-side Waiting sweep; the
 * server settles Waiting now (astrid-core waiting rules), so the only action is `ready`.
 * Task titles are never serialized, so presentation text cannot become a task id.
 */

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ["ready"] as const

type ReadyTaskAction = typeof ACTIONS[number]

export interface ReadyTaskReference {
  id: string
}

export function serializeReadyTaskQueue(input: { ready: ReadyTaskReference[] }): string {
  return JSON.stringify({
    version: 1,
    tasks: input.ready.map(task => ({ id: task.id, action: "ready" as const })),
  })
}

export function parseReadyTaskIds(output: string): string[] {
  return parseReadyTaskClaims(output).map(claim => claim.id)
}

export function parseReadyTaskClaims(output: string): Array<{
  id: string
  action: ReadyTaskAction
  commentWatermark: null
}> {
  let body: unknown
  try {
    body = JSON.parse(output)
  } catch {
    throw new Error("Queue output is not valid JSON")
  }

  if (!body || typeof body !== "object" || !("version" in body) || body.version !== 1) {
    throw new Error("Queue output has an unsupported schema version")
  }
  if (!("tasks" in body) || !Array.isArray(body.tasks)) {
    throw new Error("Queue output is missing its tasks array")
  }

  const claims = body.tasks.map((task, index) => {
    if (!task || typeof task !== "object") throw new Error(`Queue task ${index} is not an object`)
    const id = "id" in task ? task.id : undefined
    const action = "action" in task ? task.action : undefined
    if (typeof id !== "string" || !TASK_ID_PATTERN.test(id)) {
      throw new Error(`Queue task ${index} has an invalid task ID`)
    }
    if (typeof action !== "string" || !ACTIONS.includes(action as ReadyTaskAction)) {
      throw new Error(`Queue task ${index} has an invalid action`)
    }
    return { id, action: action as ReadyTaskAction, commentWatermark: null }
  })

  const ids = claims.map(claim => claim.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Queue output contained duplicate actionable task IDs")
  }

  return claims
}
