/**
 * Classify the scripts in `scripts/` by who references them, so
 * scripts/report-script-inventory.ts can hold docs/SCRIPT_INVENTORY.md to it.
 *
 * SOURCES ARE RESTRICTED TO GIT-TRACKED FILES, and that is the whole point of
 * this module existing rather than the logic living inline in the script.
 *
 * The scan used to read every file under the repository root. Two of those
 * files are per-machine and gitignored, and one of them — `.claude/
 * settings.local.json` — is a `.json` file listing pre-approved commands, so it
 * read as a CALLER of every script it names. `check-claude-agent-user.ts` and
 * `test-claude-api.ts` were therefore "caller" on a developer machine and
 * "unreferenced" in a clean checkout. The committed inventory recorded the
 * former, so `npm run check:docs` passed locally and failed in CI — and CI is
 * where it gated a production deploy.
 *
 * (`.claude/settings.json.example` IS tracked and names both scripts, but its
 * `.example` extension is not in `CALLER_EXTENSIONS`, so it never compensated.)
 *
 * A file git does not track cannot be present in CI, so it must not be allowed
 * to decide a committed answer.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, extname, join, relative } from "node:path"

export type Category = "package" | "workflow" | "documentation" | "caller" | "unreferenced"

export const CATEGORIES: Category[] = [
  "package",
  "workflow",
  "documentation",
  "caller",
  "unreferenced",
]

export const CALLER_EXTENSIONS = new Set([
  ".cjs", ".js", ".json", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml",
])

const IGNORED_DIRECTORIES = new Set([
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

export function filesUnder(root: string, directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    const relativePath = relative(root, path)
    const isDirectory = statSync(path).isDirectory()
    if (
      isDirectory &&
      [...IGNORED_DIRECTORIES].some(
        ignored => relativePath === ignored || relativePath.startsWith(`${ignored}/`)
      )
    ) {
      return []
    }
    return isDirectory ? filesUnder(root, path) : [path]
  })
}

/**
 * Repository-relative paths git is tracking, or `null` when git cannot answer.
 *
 * `null` is deliberately distinct from an empty set: "git is unavailable" must
 * fall back to scanning everything, while "git tracks nothing here" would mean
 * scanning nothing. Conflating them would let a broken git silently empty the
 * inventory, which is the failure mode this module was written to remove.
 */
export function trackedPaths(root: string): Set<string> | null {
  try {
    const stdout = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    })
    const paths = stdout.split("\0").filter(Boolean)
    return paths.length > 0 ? new Set(paths) : null
  } catch {
    return null
  }
}

/**
 * The files a clean checkout would contain, which is the only honest basis for
 * an answer that gets committed.
 */
export function scannableSources(root: string): string[] {
  const all = filesUnder(root, root)
  const tracked = trackedPaths(root)
  if (!tracked) return all
  return all.filter(path => tracked.has(relative(root, path)))
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

export function activeScripts(root: string): string[] {
  const scriptsDir = join(root, "scripts")
  const tracked = trackedPaths(root)
  return readdirSync(scriptsDir)
    .filter(name => statSync(join(scriptsDir, name)).isFile())
    // A scratch script someone has not committed would otherwise be written
    // into the inventory and then be missing in CI.
    .filter(name => !tracked || tracked.has(`scripts/${name}`))
    .sort()
}

export function buildInventory(root: string): Map<Category, string[]> {
  const scriptsDir = join(root, "scripts")
  const inventoryPath = join(root, "docs/SCRIPT_INVENTORY.md")
  const sources = scannableSources(root)

  const packageSource = readFileSync(join(root, "package.json"), "utf8")
  const workflowSources = sources
    .filter(path => relative(root, path).startsWith(".github/workflows/"))
    .map(path => readFileSync(path, "utf8"))
  const documentationSources = sources
    .filter(path => extname(path) === ".md" && path !== inventoryPath)
    .map(path => readFileSync(path, "utf8"))
  const callerSources = sources
    .filter(path => {
      const relativePath = relative(root, path)
      return (
        path !== inventoryPath &&
        relativePath !== "scripts/report-script-inventory.ts" &&
        relativePath !== "scripts/lib/script-inventory.ts" &&
        relativePath !== "package.json" &&
        !relativePath.startsWith(".github/workflows/") &&
        extname(path) !== ".md" &&
        CALLER_EXTENSIONS.has(extname(path))
      )
    })
    .map(path => readFileSync(path, "utf8"))

  const inventory = new Map<Category, string[]>(CATEGORIES.map(c => [c, [] as string[]]))

  for (const scriptName of activeScripts(root)) {
    const category: Category =
      mentions(packageSource, scriptName) ? "package" :
      workflowSources.some(source => mentions(source, scriptName)) ? "workflow" :
      documentationSources.some(source => mentions(source, scriptName)) ? "documentation" :
      callerSources.some(source => mentions(source, scriptName)) ? "caller" :
      "unreferenced"
    inventory.get(category)?.push(scriptName)
  }

  return inventory
}

export function inventoryProblems(root: string, inventory: Map<Category, string[]>): string[] {
  const documented = readFileSync(join(root, "docs/SCRIPT_INVENTORY.md"), "utf8")
  const problems: string[] = []
  for (const [category, scripts] of inventory) {
    const section = documented.match(new RegExp(`## ${category}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1] ?? ""
    const listed = [...section.matchAll(/`([^`]+)`/g)].map(match => match[1]).sort()
    if (JSON.stringify(listed) !== JSON.stringify(scripts)) {
      problems.push(`${category}: run npm run docs:scripts and update docs/SCRIPT_INVENTORY.md`)
    }
  }
  return problems
}

export { basename }
