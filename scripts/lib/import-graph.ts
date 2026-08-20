/**
 * Walk a module's transitive import graph, statically.
 *
 * Written for the middleware edge-safety guard (task fd217729). On 2026-08-10 a
 * branch added `import { detectPlatform } from '@/lib/analytics-events'` to
 * middleware.ts. That module imports Prisma at module scope, middleware runs in
 * the edge runtime, and the bundle failed to instantiate — so EVERY request
 * returned 500 for about twelve minutes, not just the API routes the change was
 * about.
 *
 * The gate was 8/8 green through all of it. `next build` compiles middleware
 * without exercising the edge runtime the way Vercel does, and no test loads
 * middleware in an edge sandbox, so the whole class of "edge-incompatible
 * import" was invisible before production. A static walk of the import graph is
 * enough to catch it, and costs milliseconds.
 *
 * Regex parsing rather than the TypeScript compiler API: the guard has to run
 * in the unit-test tier where the compiler's startup would dominate, and the
 * question here is only "which specifiers does this file name", which survives
 * a regex. It over-approximates on purpose — a specifier inside a comment or a
 * string is still followed — because for a guard, a false positive is a
 * conversation and a false negative is another outage.
 */

import fs from 'fs'
import path from 'path'

/** import/export ... from '<spec>' | import '<spec>' | import('<spec>') */
const SPECIFIER_PATTERNS = [
  /(?:^|\s)(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\s)import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

export interface ImportGraph {
  /** Repo-relative files reached, including the entry. */
  files: string[]
  /**
   * Bare specifiers reached (npm packages, node builtins). Not walked — the
   * question a guard asks about these is answered by the name alone.
   */
  externals: string[]
  /** externals -> the repo-relative files that import them, for error messages. */
  importedBy: Record<string, string[]>
}

function readSpecifiers(source: string): string[] {
  const found = new Set<string>()
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      found.add(match[1])
    }
  }
  return [...found]
}

/** Resolve a specifier to a file on disk, or null when it is external. */
function resolveSpecifier(spec: string, fromFile: string, rootDir: string): string | null {
  let base: string
  if (spec.startsWith('@/')) {
    base = path.join(rootDir, spec.slice(2))
  } else if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec)
  } else {
    return null // bare specifier: npm package or node builtin
  }

  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map(ext => base + ext),
    ...RESOLVE_EXTENSIONS.map(ext => path.join(base, `index${ext}`)),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

export function collectImportGraph(entry: string, rootDir: string): ImportGraph {
  const seen = new Set<string>()
  const externals = new Set<string>()
  const importedBy: Record<string, Set<string>> = {}
  const queue = [path.resolve(entry)]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    let source: string
    try {
      source = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    for (const spec of readSpecifiers(source)) {
      const resolved = resolveSpecifier(spec, file, rootDir)
      if (resolved) {
        queue.push(resolved)
      } else {
        externals.add(spec)
        importedBy[spec] ??= new Set()
        importedBy[spec].add(path.relative(rootDir, file))
      }
    }
  }

  return {
    files: [...seen].map(f => path.relative(rootDir, f)).sort(),
    externals: [...externals].sort(),
    importedBy: Object.fromEntries(
      Object.entries(importedBy).map(([spec, files]) => [spec, [...files].sort()]),
    ),
  }
}
