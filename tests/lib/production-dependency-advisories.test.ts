/**
 * Task f3c4fb13 — `Security Gates` had been red on every push since at least
 * 2026-09-05 because two PRODUCTION dependencies carried open advisories:
 *
 *   npm audit --audit-level=high --omit=dev   # exit 1
 *
 * The gate itself is the real check, but it only runs in CI and it needs the
 * network. This is its offline twin: it reads the versions npm actually
 * resolved and fails if one sits inside a known-vulnerable range. A red gate
 * nobody can reproduce locally is how this one stayed red for days.
 *
 * Both packages are transitive but genuinely reachable — `@modelcontextprotocol/sdk`
 * backs the MCP SSE endpoint at `pages/api/mcp/index.ts`, pulling `fast-uri`
 * through ajv's `format: uri` validation and `qs` through express — so neither
 * could be waved off with a reachability argument.
 *
 * Add an entry here whenever an advisory forces a floor on a transitive
 * package, so the floor survives the next lockfile regeneration.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Minimum safe version per advisory, and why it is pinned there. */
const FLOORS: { name: string; minimum: string; advisories: string }[] = [
  {
    name: 'fast-uri',
    minimum: '3.1.6',
    advisories:
      'high: host confusion via skipped IDN canonicalization (GHSA-5jgf-p345-68v8), ' +
      'SSRF via malformed IPv6 normalization (GHSA-f65p-4m7j-42xc), ' +
      'SSRF via repeated hostname percent-decoding (GHSA-fph4-wmhf-6fwf), ' +
      'host confusion via percent-encoded scheme normalization (GHSA-jqff-g426-hqxp)',
  },
  {
    name: 'qs',
    minimum: '6.16.0',
    advisories:
      'moderate: array-limit bypass via bracket-key comma parsing (GHSA-x5fp-wj9c-mxmx), ' +
      'DoS via attacker-controlled isBuffer (GHSA-4mjr-xmp4-gh2g)',
  },
]

interface LockEntry {
  version?: string
  dev?: boolean
  devOptional?: boolean
}

const lock: { packages: Record<string, LockEntry> } = JSON.parse(
  readFileSync(join(ROOT, 'package-lock.json'), 'utf8')
)

/** Compare two semver core versions. Prerelease tags are not used by these packages. */
function isBelow(version: string, minimum: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map(Number)
  const [a, b] = [parse(version), parse(minimum)]
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  }
  return false
}

/**
 * Every install of `name` that ships to production. `dev: true` in the lockfile
 * means the path to that copy is dev-only, which is exactly what `--omit=dev`
 * drops, so those copies are out of scope here (see task a2080a97).
 */
function productionInstalls(name: string): { path: string; version: string }[] {
  return Object.entries(lock.packages)
    .filter(([path, entry]) => {
      if (entry.dev || entry.devOptional || !entry.version) return false
      return path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)
    })
    .map(([path, entry]) => ({ path, version: entry.version as string }))
}

describe('production dependencies carry no known high-severity advisories', () => {
  for (const { name, minimum, advisories } of FLOORS) {
    it(`resolves ${name} to >= ${minimum}`, () => {
      const installs = productionInstalls(name)

      // A floor for a package that is no longer installed is dead weight, not a
      // pass — drop the entry from FLOORS instead of letting it sit here green.
      expect(installs.length, `${name} is no longer a production dependency`).toBeGreaterThan(0)

      const vulnerable = installs
        .filter(({ version }) => isBelow(version, minimum))
        .map(({ path, version }) => `${path}@${version}`)

      expect(vulnerable, `${name} < ${minimum} — ${advisories}`).toEqual([])
    })
  }
})
