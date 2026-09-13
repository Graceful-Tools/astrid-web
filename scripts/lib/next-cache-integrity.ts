/**
 * Detect and clear a corrupt `.next` cache, which otherwise 500s every route
 * under `npm run dev` with no indication of where the problem is (AWTD-934).
 *
 * The dev server parses a page's `build-manifest.json` before it invokes the
 * page, so ONE torn manifest takes down every route at once:
 *
 *     ⨯ SyntaxError: Unexpected non-whitespace character after JSON at position 1764
 *      GET / 500 in 545ms (next.js: 479ms, proxy.ts: 6ms, application-code: 60ms)
 *
 * `application-code` stays at ~1ms because no app code ran, and `npm run
 * predeploy` stays green at the same commit because `next build` writes and
 * reads `.next/` root while `next dev` uses `.next/dev` — different trees. That
 * combination reads like "my machine is broken in some deep way" rather than
 * "one file has two extra bytes", which is why this is worth automating.
 *
 * Next names no file in that error, so the guard's job is to name it.
 */
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Where `next build` writes. `next dev` writes to `<BUILD_DIR>/dev`. */
export const BUILD_DIR = '.next'
export const DEV_DIR = `${BUILD_DIR}/dev`

export interface CorruptManifest {
  /** Repo-relative path of the file that would not parse. */
  file: string
  /** Repo-relative tree to remove so Next regenerates it. */
  tree: typeof BUILD_DIR | typeof DEV_DIR
  /** Node's own parse message, since that is what the reporter will have seen. */
  reason: string
}

export interface RepairResult {
  corrupt: CorruptManifest[]
  /** Trees actually removed, outermost only. Empty when the cache is healthy. */
  cleared: string[]
}

/** Repo-relative, with forward slashes, so results read the same on any host. */
const toPosix = (root: string, absolute: string) => relative(root, absolute).split(sep).join('/')

function* jsonFiles(dir: string): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // A cache being rewritten underneath us is the normal case, not an error.
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* jsonFiles(full)
    else if (entry.name.endsWith('.json')) yield full
  }
}

/**
 * Every JSON file under `.next` that will not parse.
 *
 * Scoped to `.json` on purpose: the chunks and `trace` alongside them are not
 * parsed as JSON at boot, so a "malformed" one of those is not this bug.
 */
export function findCorruptManifests(root: string): CorruptManifest[] {
  const buildDir = join(root, BUILD_DIR)
  if (!existsSync(buildDir)) return []

  const corrupt: CorruptManifest[] = []
  for (const file of jsonFiles(buildDir)) {
    let contents
    try {
      contents = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    try {
      JSON.parse(contents)
    } catch (error) {
      const path = toPosix(root, file)
      corrupt.push({
        file: path,
        tree: path.startsWith(`${DEV_DIR}/`) ? DEV_DIR : BUILD_DIR,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return corrupt
}

/**
 * Clear the smallest tree that contains the damage — `.next/dev` when only the
 * dev server is affected, so a good production build in `.next/` survives.
 *
 * When both are damaged, `.next` alone is removed: `.next/dev` is inside it, and
 * removing a path whose parent has already gone would be a no-op reported as
 * work done.
 */
export function repairNextCache(root: string, options: { dryRun?: boolean } = {}): RepairResult {
  const corrupt = findCorruptManifests(root)
  if (corrupt.length === 0) return { corrupt, cleared: [] }

  const trees = new Set(corrupt.map(entry => entry.tree))
  const cleared = trees.has(BUILD_DIR) ? [BUILD_DIR] : [DEV_DIR]

  if (!options.dryRun) {
    for (const tree of cleared) rmSync(join(root, tree), { recursive: true, force: true })
  }
  return { corrupt, cleared }
}
