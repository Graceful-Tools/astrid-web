#!/usr/bin/env tsx

import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join, relative } from "node:path"

type Category = "package" | "workflow" | "documentation" | "caller" | "unreferenced"

const root = process.cwd()
const scriptsDir = join(root, "scripts")
const inventoryPath = join(root, "docs/SCRIPT_INVENTORY.md")
const callerExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml"])
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".vercel",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
  "docs/archive",
  "scripts/archive",
])

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    const relativePath = relative(root, path)
    if (
      statSync(path).isDirectory() &&
      [...ignoredDirectories].some(ignored => relativePath === ignored || relativePath.startsWith(`${ignored}/`))
    ) {
      return []
    }
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function mentions(source: string, scriptName: string): boolean {
  const extension = extname(scriptName)
  const stem = extension ? scriptName.slice(0, -extension.length) : scriptName
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return (
    source.includes(`scripts/${scriptName}`) ||
    source.includes(`./${scriptName}`) ||
    new RegExp(`(?:scripts/|\\./)${escapedStem}(?=["'\\s]|$)`).test(source)
  )
}

const activeScripts = readdirSync(scriptsDir)
  .filter(name => statSync(join(scriptsDir, name)).isFile())
  .sort()

const packageSource = readFileSync(join(root, "package.json"), "utf8")
const workflowSources = filesUnder(join(root, ".github/workflows"))
  .map(path => readFileSync(path, "utf8"))
const documentationSources = filesUnder(root)
  .filter(path => extname(path) === ".md")
  .filter(path => path !== inventoryPath)
  .map(path => readFileSync(path, "utf8"))
const callerSources = filesUnder(root)
  .filter(path => {
    const relativePath = relative(root, path)
    return (
      path !== inventoryPath &&
      path !== join(scriptsDir, basename(import.meta.filename)) &&
      relativePath !== "package.json" &&
      !relativePath.startsWith(".github/workflows/") &&
      extname(path) !== ".md" &&
      callerExtensions.has(extname(path))
    )
  })
  .map(path => readFileSync(path, "utf8"))

const inventory = new Map<Category, string[]>([
  ["package", []],
  ["workflow", []],
  ["documentation", []],
  ["caller", []],
  ["unreferenced", []],
])

for (const scriptName of activeScripts) {
  const category: Category =
    mentions(packageSource, scriptName) ? "package" :
    workflowSources.some(source => mentions(source, scriptName)) ? "workflow" :
    documentationSources.some(source => mentions(source, scriptName)) ? "documentation" :
    callerSources.some(source => mentions(source, scriptName)) ? "caller" :
    "unreferenced"
  inventory.get(category)?.push(scriptName)
}

if (process.argv.includes("--check")) {
  const documented = readFileSync(inventoryPath, "utf8")
  const problems: string[] = []
  for (const [category, scripts] of inventory) {
    const section = documented.match(new RegExp(`## ${category}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? ""
    const listed = [...section.matchAll(/`([^`]+)`/g)].map(match => match[1]).sort()
    if (JSON.stringify(listed) !== JSON.stringify(scripts)) {
      problems.push(`${category}: run npm run docs:scripts and update docs/SCRIPT_INVENTORY.md`)
    }
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log(`Script inventory valid for ${activeScripts.length} active top-level files.`)
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
