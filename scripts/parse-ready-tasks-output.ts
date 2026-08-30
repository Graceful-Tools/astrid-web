import { readFileSync } from "node:fs"
import { parseReadyTaskIds } from "./lib/ready-tasks-output"

try {
  const output = readFileSync(0, "utf8")
  process.stdout.write(parseReadyTaskIds(output).join("\n"))
} catch (error) {
  console.error(`Invalid ready-tasks output: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
