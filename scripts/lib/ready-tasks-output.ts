const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ["ready", "recheck", "review"] as const

type ReadyTaskAction = typeof ACTIONS[number]

export interface ReadyTaskReference {
  id: string
  commentWatermark?: string | null
}

export function serializeReadyTaskQueue(input: {
  ready: ReadyTaskReference[]
  recheck: ReadyTaskReference[]
  review: ReadyTaskReference[]
}): string {
  return JSON.stringify({
    version: 1,
    tasks: [
      ...input.recheck.map(task => ({
        id: task.id,
        action: "recheck" as const,
        commentWatermark: task.commentWatermark ?? null,
      })),
      ...input.review.map(task => ({
        id: task.id,
        action: "review" as const,
        commentWatermark: task.commentWatermark ?? null,
      })),
      ...input.ready.map(task => ({ id: task.id, action: "ready" as const })),
    ],
  })
}

export function parseReadyTaskIds(output: string): string[] {
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
    const commentWatermark = "commentWatermark" in task ? task.commentWatermark : undefined
    if (
      action !== "ready" &&
      commentWatermark !== null &&
      (typeof commentWatermark !== "string" || Number.isNaN(Date.parse(commentWatermark)))
    ) {
      throw new Error(`Queue task ${index} has an invalid comment watermark`)
    }
    return {
      id,
      action: action as ReadyTaskAction,
      commentWatermark: action === "ready" ? null : (commentWatermark as string | null),
    }
  })

  const ids = claims.map(claim => claim.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Queue output contained duplicate actionable task IDs")
  }

  return ids
}

export function parseReadyTaskClaims(output: string): Array<{
  id: string
  action: ReadyTaskAction
  commentWatermark: string | null
}> {
  const body = JSON.parse(output) as { tasks?: unknown[] }
  parseReadyTaskIds(output)
  return (body.tasks ?? []).map(task => {
    const claim = task as { id: string; action: ReadyTaskAction; commentWatermark?: string | null }
    return {
      id: claim.id,
      action: claim.action,
      commentWatermark: claim.commentWatermark ?? null,
    }
  })
}
