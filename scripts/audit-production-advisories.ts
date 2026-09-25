/**
 * AWTD-914: is anything we SHIP carrying a known advisory?
 *
 * The same question `npm audit --omit=dev` answers, from the same two inputs:
 * the resolved tree in `package-lock.json`, and the registry's advisory
 * database (`/-/npm/v1/security/advisories/bulk`, the endpoint `npm audit`
 * itself POSTs to). It exists because `npm audit` needs interactive approval in
 * this repo's harness, so the weekly recheck could not run unattended — and a
 * weekly security question nobody can answer without a human present is a
 * question that stops getting asked.
 *
 * This is deliberately NOT a unit test. The answers change without any commit,
 * so it would fail on a plane and go green on a bad day. The complementary
 * offline guard is `tests/rules/production-tree-has-no-known-rce.test.ts`,
 * which ratchets floors already cleared and runs in `npm run predeploy`. That
 * test cannot know about a NEW advisory; this script is what finds those.
 *
 * ## The failure mode this script is built around
 *
 * AWTD-909's lesson was not "an advisory was missed". It was that the recheck
 * command *could not answer its own question*, and reported reassuringly
 * anyway — two critical unauthenticated RCEs sat in production for weeks behind
 * a weekly "still dev-only, not urgent".
 *
 * So a clean result here has to be distinguishable from a blind one. Before
 * trusting any answer, `selfCheck()` asks the registry about a version whose
 * advisories are already known (`next@16.3.2`, two criticals) and requires them
 * to come back. If they do not, the data source changed shape or the network
 * lied, and this exits `EXIT_UNKNOWN` — never `clean`. Silence is only evidence
 * once you have proved you would have heard something.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const BULK_ENDPOINT =
  'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk'
const LOCKFILE = 'package-lock.json'

/** Packages per request. The endpoint rejects very large bodies. */
const CHUNK_SIZE = 200

export const EXIT_CLEAN = 0
export const EXIT_FOUND = 1
export const EXIT_UNKNOWN = 3

/** A version known to be covered by advisories, used to prove we can see them. */
const CANARY = { name: 'next', version: '16.3.2', minAdvisories: 1 }

interface LockEntry {
  version?: string
  dev?: boolean
  optional?: boolean
  devOptional?: boolean
}

interface Lockfile {
  lockfileVersion: number
  packages: Record<string, LockEntry>
}

export interface Advisory {
  id: number
  url: string
  title: string
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  vulnerable_versions: string
  cwe?: string[]
  cvss?: { score: number | null; vectorString: string | null }
}

export type BulkResponse = Record<string, Advisory[]>

export interface Finding {
  name: string
  version: string
  paths: string[]
  advisory: Advisory
}

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'] as const
export type Severity = (typeof SEVERITY_ORDER)[number]

/**
 * Thrown when a `vulnerable_versions` range uses syntax this matcher does not
 * implement. It is deliberately fatal rather than a `false`: an unrecognised
 * range that quietly means "not vulnerable" is an advisory silently discarded,
 * which is the one outcome this whole script exists to prevent.
 */
export class UnparseableRangeError extends Error {}

interface ParsedVersion {
  release: number[]
  prerelease: string[]
}

export function parseVersion(version: string): ParsedVersion {
  const cleaned = version.trim().replace(/^[v=\s]+/, '')
  const [core, ...rest] = cleaned.split('+')[0].split('-')
  const release = core.split('.').map(part => Number.parseInt(part, 10) || 0)
  while (release.length < 3) release.push(0)
  return { release, prerelease: rest.length > 0 ? rest.join('-').split('.') : [] }
}

/**
 * Semver precedence, including the prerelease rule that 1.0.0-alpha sorts
 * BELOW 1.0.0. That rule matters: advisory ranges are overwhelmingly of the
 * form `<16.3.3`, and treating 16.3.3-canary.1 as equal to 16.3.3 would call a
 * prerelease of the fix patched when it is not.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)]

  for (let i = 0; i < Math.max(x.release.length, y.release.length); i++) {
    const diff = (x.release[i] ?? 0) - (y.release[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }

  if (x.prerelease.length === 0 && y.prerelease.length === 0) return 0
  if (x.prerelease.length === 0) return 1
  if (y.prerelease.length === 0) return -1

  for (let i = 0; i < Math.max(x.prerelease.length, y.prerelease.length); i++) {
    const [p, q] = [x.prerelease[i], y.prerelease[i]]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const [pn, qn] = [Number.parseInt(p, 10), Number.parseInt(q, 10)]
    const bothNumeric = !Number.isNaN(pn) && !Number.isNaN(qn)
    if (bothNumeric) return pn < qn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

const COMPARATOR = /^(>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?)$/

type Comparator = { operator: string; bound: string } | { always: true }

/**
 * Parse one comparator, e.g. `>=16.0.0`. Parsing is separated from evaluation
 * on purpose: done inline, `every()`'s short-circuit means an unparseable token
 * is only ever noticed when the tokens before it happen to match. A hyphen
 * range would then read as "not vulnerable" for most versions and throw for a
 * few — a silent discard that depends on the version being checked.
 */
function parseComparator(token: string): Comparator {
  if (token === '*') return { always: true }

  const match = COMPARATOR.exec(token)
  if (!match) {
    // `^`, `~`, `x`-ranges and hyphen ranges land here. npm's advisory feed
    // normalises to plain comparators, so hitting this means the feed changed
    // shape — worth stopping for, not guessing past.
    throw new UnparseableRangeError(
      `cannot interpret version comparator "${token}". Refusing to treat an ` +
        `advisory range this matcher does not understand as "not vulnerable".`
    )
  }

  const [, operator = '=', bound] = match
  return { operator, bound }
}

function evaluate(version: string, comparator: Comparator): boolean {
  if ('always' in comparator) return true
  const order = compareVersions(version, comparator.bound)
  switch (comparator.operator) {
    case '>=':
      return order >= 0
    case '<=':
      return order <= 0
    case '>':
      return order > 0
    case '<':
      return order < 0
    default:
      return order === 0
  }
}

/**
 * Does an installed version fall inside an advisory's `vulnerable_versions`?
 * The grammar is comparator sets joined by `||`, each set a space-separated
 * conjunction — `>=4.0.0 <4.3.2`, `<0.35.4`, `<=4.13.4`.
 *
 * The WHOLE range is parsed before any of it is evaluated, so an unparseable
 * token always raises, whatever version is being checked.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const sets = range.split('||').map(set =>
    set
      .trim()
      .split(/\s+/)
      .filter(token => token.length > 0)
      .map(parseComparator)
  )

  return sets.some(set => set.every(comparator => evaluate(version, comparator)))
}

/**
 * A package reaches production unless the lockfile marks it dev-only. `dev`
 * means "only reachable from devDependencies"; `devOptional` means "dev, or an
 * optional dep of something shipped", which counts as shipping because the
 * optional branch does install on Vercel (`sharp` is exactly this).
 *
 * Identical rule, and identical reasoning, to `shipped()` in
 * tests/rules/production-tree-has-no-known-rce.test.ts. Both read the lockfile
 * because it is the only place that records which branch resolved a package.
 */
function shipped(entry: LockEntry): boolean {
  return entry.dev !== true
}

/** The package name for a lockfile path, or null for the root/workspace entry. */
export function packageNameFor(path: string): string | null {
  const marker = 'node_modules/'
  const at = path.lastIndexOf(marker)
  if (at === -1) return null
  const name = path.slice(at + marker.length)
  return name.length > 0 ? name : null
}

/** Every shipped (name, version) in the tree, with the paths that install it. */
export function productionTree(lock: Lockfile): Map<string, Map<string, string[]>> {
  const tree = new Map<string, Map<string, string[]>>()
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!shipped(entry) || !entry.version) continue
    const name = packageNameFor(path)
    if (!name) continue
    const byVersion = tree.get(name) ?? new Map<string, string[]>()
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), path])
    tree.set(name, byVersion)
  }
  return tree
}

async function queryBulk(query: Record<string, string[]>): Promise<BulkResponse> {
  const response = await fetch(BULK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  })
  if (!response.ok) {
    throw new Error(
      `advisory endpoint returned ${response.status} ${response.statusText}`
    )
  }
  return (await response.json()) as BulkResponse
}

/**
 * Prove the advisory feed still answers before believing that it said nothing.
 * Without this, a renamed field, a silently-emptied response or a captive
 * portal all read exactly like a clean production tree.
 */
async function selfCheck(): Promise<void> {
  const seen = await queryBulk({ [CANARY.name]: [CANARY.version] })
  const advisories = seen[CANARY.name] ?? []
  if (advisories.length < CANARY.minAdvisories) {
    throw new Error(
      `self-check failed: ${CANARY.name}@${CANARY.version} is known to be covered by ` +
        `advisories, but the endpoint reported ${advisories.length}. Refusing to report ` +
        `a clean tree from a source that cannot be shown to work. If ${CANARY.name}@` +
        `${CANARY.version} was genuinely withdrawn, move the canary to another known-bad ` +
        `version rather than deleting this check.`
    )
  }
  const matched = advisories.filter(a =>
    satisfiesRange(CANARY.version, a.vulnerable_versions)
  )
  if (matched.length === 0) {
    throw new Error(
      `self-check failed: advisories came back for ${CANARY.name}@${CANARY.version} but ` +
        `none of their vulnerable_versions ranges matched it, so range matching is broken ` +
        `and every real finding would be discarded as inapplicable.`
    )
  }
}

/** Only advisories whose range actually covers the installed version. */
export function findingsFor(
  tree: Map<string, Map<string, string[]>>,
  advisories: BulkResponse
): Finding[] {
  const findings: Finding[] = []
  for (const [name, forName] of Object.entries(advisories)) {
    const byVersion = tree.get(name)
    if (!byVersion) continue
    for (const [version, paths] of byVersion) {
      for (const advisory of forName) {
        if (satisfiesRange(version, advisory.vulnerable_versions)) {
          findings.push({ name, version, paths, advisory })
        }
      }
    }
  }
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.advisory.severity) -
        SEVERITY_ORDER.indexOf(b.advisory.severity) ||
      a.name.localeCompare(b.name)
  )
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_ORDER.map(s => [s, 0])) as Record<
    Severity,
    number
  >
  for (const finding of findings) counts[finding.advisory.severity]++
  return counts
}

/**
 * The declared range for a package, so a finding says whether the fix is a
 * lockfile refresh or an upgrade decision. That distinction is the cheapest
 * information in the whole report: in AWTD-909 the patched `next` was already
 * inside the accepted `^16.2.9` and only the lockfile was stale.
 */
function declaredRanges(): Map<string, string> {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  const declared = new Map<string, string>()
  for (const field of ['dependencies', 'optionalDependencies', 'overrides']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (typeof range === 'string') declared.set(name, `${field}: ${range}`)
    }
  }
  return declared
}

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json')
  const lock: Lockfile = JSON.parse(
    readFileSync(join(process.cwd(), LOCKFILE), 'utf8')
  )
  const tree = productionTree(lock)

  try {
    await selfCheck()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (asJson) {
      console.log(JSON.stringify({ status: 'unknown', reason: message }, null, 2))
    } else {
      console.error(`UNKNOWN — could not establish that advisories are visible.\n${message}`)
    }
    return EXIT_UNKNOWN
  }

  const names = [...tree.keys()].sort()
  const advisories: BulkResponse = {}
  try {
    for (let i = 0; i < names.length; i += CHUNK_SIZE) {
      const query = Object.fromEntries(
        names.slice(i, i + CHUNK_SIZE).map(name => [name, [...tree.get(name)!.keys()]])
      )
      Object.assign(advisories, await queryBulk(query))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (asJson) {
      console.log(JSON.stringify({ status: 'unknown', reason: message }, null, 2))
    } else {
      console.error(`UNKNOWN — the advisory query failed part-way.\n${message}`)
    }
    return EXIT_UNKNOWN
  }

  let findings: Finding[]
  try {
    findings = findingsFor(tree, advisories)
  } catch (error) {
    // An advisory range we cannot parse means we do not know whether the tree
    // is affected. That is not the same as unaffected, and must not print as it.
    const message = error instanceof Error ? error.message : String(error)
    if (asJson) {
      console.log(JSON.stringify({ status: 'unknown', reason: message }, null, 2))
    } else {
      console.error(`UNKNOWN — an advisory range could not be interpreted.\n${message}`)
    }
    return EXIT_UNKNOWN
  }

  const counts = countBySeverity(findings)
  const blocking = counts.critical + counts.high
  const declared = declaredRanges()

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          status: blocking > 0 ? 'found' : 'clean',
          packagesAudited: names.length,
          counts,
          findings: findings.map(f => ({
            name: f.name,
            installed: f.version,
            severity: f.advisory.severity,
            advisory: f.advisory.url,
            title: f.advisory.title,
            vulnerableVersions: f.advisory.vulnerable_versions,
            declared: declared.get(f.name) ?? null,
            paths: f.paths,
          })),
        },
        null,
        2
      )
    )
    return blocking > 0 ? EXIT_FOUND : EXIT_CLEAN
  }

  const summary = SEVERITY_ORDER.map(s => `${s}=${counts[s]}`).join('  ')
  console.log(`production tree: ${names.length} packages audited`)
  console.log(summary)

  for (const finding of findings) {
    const { advisory } = finding
    console.log(
      [
        '',
        `${advisory.severity.toUpperCase()}  ${finding.name}@${finding.version}`,
        `  ${advisory.title}`,
        `  ${advisory.url}`,
        `  vulnerable: ${advisory.vulnerable_versions}`,
        `  declared:   ${declared.get(finding.name) ?? '(transitive — no direct range)'}`,
        `  installed at: ${finding.paths.slice(0, 5).join(', ')}${
          finding.paths.length > 5 ? ` (+${finding.paths.length - 5} more)` : ''
        }`,
      ].join('\n')
    )
  }

  console.log(
    blocking > 0
      ? `\nFOUND — ${blocking} critical/high in the shipping tree. File each as its own task.`
      : `\nCLEAN — nothing critical or high in the shipping tree.`
  )
  return blocking > 0 ? EXIT_FOUND : EXIT_CLEAN
}

/**
 * Only run the audit when invoked as a script. Importing this file — which the
 * offline tests for the pure helpers do — must not fire a network sweep.
 */
const invokedDirectly = process.argv[1]?.includes('audit-production-advisories')

if (invokedDirectly) {
  main().then(
    code => process.exit(code),
    error => {
      console.error(error)
      process.exit(EXIT_UNKNOWN)
    }
  )
}
