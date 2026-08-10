#!/usr/bin/env npx tsx
/**
 * Legacy API retirement coverage report. (Task 641a7615, step 4)
 *
 * Usage:
 *   npx tsx scripts/legacy-api-coverage.ts            # summary + the blocking routes
 *   npx tsx scripts/legacy-api-coverage.ts --all      # every in-scope route
 *   npx tsx scripts/legacy-api-coverage.ts --status needs-decision
 *
 * Answers, per legacy route: does a v1 successor exist, and does any client
 * still call the legacy path. Step 4 is "delete per-route as traffic hits
 * zero", and that question cannot be answered from the deprecation telemetry
 * alone — telemetry says whether anyone IS calling it, not whether anywhere
 * still could.
 *
 * It exists because doing this by hand went wrong twice in one session: I
 * reported `/api/secure-files` and `/api/chat` as having no v1 successor when
 * both had full coverage, hiding the easiest remaining work behind a confident
 * wrong answer. Derived from the filesystem, it cannot make that mistake.
 *
 * Caller counting is a text scan, so treat it as a lower bound worth checking
 * rather than proof: a path built by string concatenation will not be seen.
 * That is why a zero here means "look closer", not "safe to delete" — the
 * traffic evidence is what makes deletion safe, and this only says whether the
 * code still points at it.
 */

import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  routeFileToApiPath,
  v1PathFor,
  matchLiteralToRoute,
  classifyRoute,
  summarize,
  STATUS_ORDER,
  type RouteCoverage,
  type RouteStatus,
} from '../lib/legacy-api-coverage'

const CLIENT_ROOTS = ['components', 'hooks', 'lib', 'contexts', 'app']
const CODE = /\.(ts|tsx)$/

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Files that DESCRIBE the API surface rather than call it.
 *
 * Each holds legacy paths as data — a rename table, a deprecation census, an
 * iOS contract map — and a text scan cannot tell that from a fetch. Left in,
 * this module's own override table registered as a caller of all 13 routes it
 * maps, which put finished migrations back into "callers remain".
 */
const DESCRIBES_THE_API = [
  'lib/legacy-api-coverage.ts',
  'lib/api-deprecation.ts',
  'lib/legacy-api-usage.ts',
  'lib/api-contracts/',
]

/** Every file that could contain a client call — excludes the routes themselves. */
function clientFiles(): string[] {
  return CLIENT_ROOTS.flatMap((root) => walk(root))
    .filter((f) => CODE.test(f))
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !f.startsWith('app/api/'))
    .filter((f) => !DESCRIBES_THE_API.some((prefix) => f.startsWith(prefix)))
}

/**
 * Every quoted `/api/...` literal in a file, normalised for matching.
 *
 * `${expr}` becomes a placeholder segment so a template literal resolves to
 * the same route as the equivalent static path. Query strings and trailing
 * slashes are dropped — they are not part of which route serves the call.
 */
function extractApiLiterals(source: string): string[] {
  const out: string[] = []
  const re = /['"`](\/api\/[^'"`\s]*)['"`]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const literal = match[1]
      .replace(/\$\{[^}]*\}/g, 'x')
      .split('?')[0]
      .replace(/\/$/, '')
    if (literal.startsWith('/api/')) out.push(literal)
  }
  return out
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function main() {
  const args = process.argv.slice(2)
  const showAll = args.includes('--all')
  const statusFilter = args.includes('--status')
    ? (args[args.indexOf('--status') + 1] as RouteStatus)
    : null

  const routeFiles = walk('app/api').filter((f) => /route\.tsx?$/.test(f))
  const v1Paths = new Set(
    routeFiles.map(routeFileToApiPath).filter((p) => p.startsWith('/api/v1/'))
  )

  const legacyRoutePaths = routeFiles
    .map(routeFileToApiPath)
    .filter((p) => !p.startsWith('/api/v1/'))

  // One file counts once per route, so the number reads as "how many files
  // still point here" rather than being skewed by a loop that repeats a path.
  const callerCounts = new Map<string, number>()
  for (const file of clientFiles()) {
    const source = stripComments(readFileSync(file, 'utf8'))
    const routesInFile = new Set<string>()
    for (const literal of extractApiLiterals(source)) {
      const route = matchLiteralToRoute(literal, legacyRoutePaths)
      if (route) routesInFile.add(route)
    }
    for (const route of routesInFile) {
      callerCounts.set(route, (callerCounts.get(route) ?? 0) + 1)
    }
  }

  const routes: RouteCoverage[] = routeFiles
    .map(routeFileToApiPath)
    .filter((apiPath) => !apiPath.startsWith('/api/v1/'))
    .map((apiPath) => {
      const v1Path = v1PathFor(apiPath)
      const hasV1 = v1Path !== null && v1Paths.has(v1Path)
      const callerCount = callerCounts.get(apiPath) ?? 0
      return { apiPath, v1Path, hasV1, callerCount, status: classifyRoute({ apiPath, hasV1, callerCount }) }
    })
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.apiPath.localeCompare(b.apiPath))

  const counts = summarize(routes)

  console.log('\nLegacy API retirement coverage (task 641a7615)\n')
  for (const status of STATUS_ORDER) {
    console.log(`  ${String(counts[status]).padStart(3)}  ${status}`)
  }
  console.log()

  const shown = routes.filter((r) => {
    if (statusFilter) return r.status === statusFilter
    if (showAll) return r.status !== 'out-of-scope'
    return r.status === 'needs-decision' || r.status === 'callers-remain'
  })

  if (shown.length === 0) {
    console.log('Nothing to show for that filter.\n')
    return
  }

  const width = Math.max(...shown.map((r) => r.apiPath.length))
  let current: RouteStatus | null = null
  for (const route of shown) {
    if (route.status !== current) {
      current = route.status
      console.log(`\n${current}`)
    }
    const v1 = route.hasV1 ? 'v1 ✓' : 'v1 ✗'
    console.log(`  ${route.apiPath.padEnd(width)}  ${v1}  callers: ${route.callerCount}`)
  }
  console.log('\nCaller counts are a text scan — a lower bound, not proof. Deletion is')
  console.log('gated on traffic evidence (lib/legacy-api-usage.ts), not on this.\n')
}

main()
