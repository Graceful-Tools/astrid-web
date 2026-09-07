#!/usr/bin/env tsx

/**
 * Report (or verify) which scripts in `scripts/` are referenced, and from where.
 *
 * The scanning and classification live in scripts/lib/script-inventory.ts so
 * they can be tested directly — see tests/scripts/script-inventory-sources.ts
 * and the note there about why the source set is restricted to git-tracked
 * files.
 */
import { buildInventory, inventoryProblems, activeScripts } from "./lib/script-inventory"

const root = process.cwd()
const inventory = buildInventory(root)

if (process.argv.includes("--check")) {
  const problems = inventoryProblems(root, inventory)
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log(`Script inventory valid for ${activeScripts(root).length} active top-level files.`)
  process.exit(0)
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(Object.fromEntries(inventory), null, 2))
  process.exit(0)
}

console.log("# Active script inventory\n")
for (const [category, scripts] of inventory) {
  console.log(`## ${category}\n`)
  console.log(scripts.map(script => `\`${script}\``).join(", "))
  console.log()
}
