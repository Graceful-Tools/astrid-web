import { readFileSync } from "node:fs"
import { parseReadyTaskClaims, parseReadyTaskIds } from "./lib/ready-tasks-output"

try {
  const output = readFileSync(0, "utf8")
  if (process.argv.includes("--claims")) {
    process.stdout.write(parseReadyTaskClaims(output).map(claim =>
      [claim.id, claim.action, claim.commentWatermark ?? ""].join("\t")
    ).join("\n"))
  } else {
    process.stdout.write(parseReadyTaskIds(output).join("\n"))
  }
} catch (error) {
  console.error(`Invalid ready-tasks output: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
