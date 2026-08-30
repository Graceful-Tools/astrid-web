const TASK_ID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const SECTION_PATTERN = /^(READY|RECHECK|REVIEW) \((\d+)\)(?::| —)/
const TASK_PATTERN = new RegExp(`^  (${TASK_ID_PATTERN})  `, "i")

export function parseReadyTaskIds(output: string): string[] {
  const ids: string[] = []
  let expectedCount = 0
  let currentSection: string | null = null
  let sawReadyResult = false

  for (const line of output.split(/\r?\n/)) {
    const section = line.match(SECTION_PATTERN)
    if (section) {
      currentSection = section[1]
      expectedCount += Number(section[2])
      if (currentSection === "READY") sawReadyResult = true
      continue
    }

    if (line.startsWith("READY_EMPTY")) {
      currentSection = null
      sawReadyResult = true
      continue
    }

    const task = line.match(TASK_PATTERN)
    if (task && currentSection) ids.push(task[1])
  }

  if (!sawReadyResult) {
    throw new Error("Queue output did not contain READY (...) or READY_EMPTY")
  }
  if (ids.length !== expectedCount) {
    throw new Error(`Queue output declared ${expectedCount} actionable task(s), but parsed ${ids.length}`)
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("Queue output contained duplicate actionable task IDs")
  }

  return ids
}
