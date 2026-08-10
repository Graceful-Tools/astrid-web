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

/**
 * The iOS app, checked read-only. Deletion needs "no CLIENT calls it", and web
 * is only half of that — a route with zero web callers that iOS still uses is
 * not deletable, and nothing in this repo would have said so.
 *
 * Skipped with a warning when the checkout is absent, because the web half of
 * the report is still worth having and a missing sibling repo is a normal
 * state for CI, not an error.
 */
const IOS_REPO = '../astrid-ios'
const SWIFT = /\.swift$/

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

/**
 * iOS files that reference legacy paths without calling them.
 *
 * Test targets assert about the paths (the contract tests literally list the
 * legacy ones to prove they are unused), and ImageCache matches BOTH URL forms
 * because attachment URLs are persisted — the same reason web's
 * extractSecureFileId keeps its legacy branch. Counting either as a caller
 * would report iOS as unmigrated when it is not.
 */
const IOS_NOT_A_CALLER = ['Tests/', 'Tests.swift', 'ImageCache.swift']

function iosFiles(): string[] {
  try {
    if (!statSync(IOS_REPO).isDirectory()) return []
  } catch {
    return []
  }
  return walk(IOS_REPO)
    .filter((f) => SWIFT.test(f))
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !f.includes('/.build/'))
    .filter((f) => !IOS_NOT_A_CALLER.some((marker) => f.includes(marker)))
}

/** Swift line comments; block comments are rare enough here to leave alone. */
function stripSwiftComments(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, '$1')
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
  const iosCallerCounts = new Map<string, number>()

  const tally = (files: string[], strip: (s: string) => string, into: Map<string, number>) => {
    for (const file of files) {
      const source = strip(readFileSync(file, 'utf8'))
      const routesInFile = new Set<string>()
      for (const literal of extractApiLiterals(source)) {
        const route = matchLiteralToRoute(literal, legacyRoutePaths)
        if (route) routesInFile.add(route)
      }
      for (const route of routesInFile) {
        into.set(route, (into.get(route) ?? 0) + 1)
      }
    }
  }

  tally(clientFiles(), stripComments, callerCounts)

  const ios = iosFiles()
  if (ios.length === 0) {
    console.log('\nNote: no ../astrid-ios checkout — iOS callers not counted.')
  } else {
    tally(ios, stripSwiftComments, iosCallerCounts)
    // Print the scan size. A scanner that read nothing reports the same zeros
    // as a client that has fully migrated, and the difference decides whether
    // a route can be deleted.
    const iosTotal = [...iosCallerCounts.values()].reduce((a, b) => a + b, 0)
    console.log(`\niOS: scanned ${ios.length} Swift files, found ${iosTotal} legacy caller reference(s).`)
  }

  const routes: RouteCoverage[] = routeFiles
    .map(routeFileToApiPath)
    .filter((apiPath) => !apiPath.startsWith('/api/v1/'))
    .map((apiPath) => {
      const v1Path = v1PathFor(apiPath)
      const hasV1 = v1Path !== null && v1Paths.has(v1Path)
      // A route is only callerless when BOTH clients have moved off it.
      const callerCount = (callerCounts.get(apiPath) ?? 0) + (iosCallerCounts.get(apiPath) ?? 0)
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
    const web = callerCounts.get(route.apiPath) ?? 0
    const iosCount = iosCallerCounts.get(route.apiPath) ?? 0
    console.log(`  ${route.apiPath.padEnd(width)}  ${v1}  web: ${web}  ios: ${iosCount}`)
  }
  console.log('\nCaller counts are a text scan — a lower bound, not proof. Deletion is')
  console.log('gated on traffic evidence (lib/legacy-api-usage.ts), not on this.\n')
}

main()
