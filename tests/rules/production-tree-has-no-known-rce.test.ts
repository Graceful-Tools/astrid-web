/**
 * AWTD-909: the SHIPPING dependency tree may not carry a version that a known
 * advisory covers.
 *
 * Two critical unauthenticated RCEs in `next` (GHSA-2xp9-vwfh-vxw4, the Image
 * Optimization API with AVIF files; GHSA-p293-qw3h-jr36) sat open in production
 * while the task that exists to track dependency advisories reported "still
 * blocked, still dev-only, not urgent" every week.
 *
 * Neither half of that report was true, and the reason it went unnoticed is the
 * interesting part. AWTD-540 attributed the whole advisory backlog to one root
 * — the eslint 9 pin — and its weekly recheck was
 * `npm view eslint-plugin-react version peerDependencies.eslint`. That command
 * answers "can we upgrade eslint yet". It cannot answer "is anything we ship
 * vulnerable", and once the backlog was framed as one blocker, checking the
 * blocker felt like checking the backlog. Five of the twelve advisories were in
 * the production tree.
 *
 * The fix itself was a lockfile update: `next`'s declared range was already
 * `^16.2.9` and 16.3.5 was published, so the repo had *accepted* the patched
 * version and merely had a stale `package-lock.json`. That is the mechanism
 * this test guards, because it is the one that can silently come back — a
 * regenerated or hand-merged lockfile can walk a version backwards inside a
 * range nobody has to re-approve.
 *
 * Why the lockfile and not `npm audit`: `npm audit` is a network call against a
 * registry whose answers change without any commit, so it cannot be a unit test
 * (it would fail on a plane and go green on a bad day). The advisory floors
 * below are therefore recorded by hand, with the advisory that set each one. A
 * NEW advisory still needs someone to run `npm audit --omit=dev` — that is what
 * the recurring audit task is for. This test's job is narrower and absolute: a
 * floor we have already cleared must never regress.
 *
 * Adding to this list is expected as advisories land. Never LOWER a floor to
 * make this pass — a floor going down means the shipping tree went back to
 * known-vulnerable code, which is exactly the state this file exists to make
 * loud.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const LOCKFILE = 'package-lock.json'

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

const lock: Lockfile = JSON.parse(readFileSync(join(ROOT, LOCKFILE), 'utf8'))

/**
 * A package reaches production unless the lockfile marks it dev-only. `dev`
 * means "only reachable from devDependencies"; `devOptional` means "dev, or an
 * optional dep of something shipped", which we treat as shipping because the
 * optional branch does install on Vercel (`sharp` is exactly this).
 */
function shipped(entry: LockEntry): boolean {
  return entry.dev !== true
}

/** Every lockfile path that installs the given package name. */
function entriesFor(name: string): Array<[string, LockEntry]> {
  const suffix = `node_modules/${name}`
  return Object.entries(lock.packages).filter(
    ([path]) => path === suffix || path.endsWith(`/${suffix}`)
  )
}

/** Numeric comparison of two release versions; prerelease tags are ignored. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^[^\d]*/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map(n => Number.parseInt(n, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Minimum version each package must be at in the SHIPPING tree, with the
 * advisory that set the floor. These are floors, not pins — a higher version is
 * always fine.
 */
const ADVISORY_FLOORS: Array<{
  name: string
  minVersion: string
  severity: string
  advisory: string
}> = [
  {
    name: 'next',
    minVersion: '16.3.3',
    severity: 'critical',
    advisory:
      'GHSA-2xp9-vwfh-vxw4 (unauthenticated RCE in the Image Optimization API with AVIF) ' +
      'and GHSA-p293-qw3h-jr36 (unauthenticated RCE on Windows hosts); both <16.3.3',
  },
  {
    name: 'sharp',
    minVersion: '0.35.4',
    severity: 'high',
    advisory: 'GHSA-rgj7-g3m4-5g8c (libheif); <0.35.4. Reached through `next`',
  },
  {
    name: 'js-yaml',
    minVersion: '4.3.2',
    severity: 'high',
    advisory:
      'GHSA-2883-xcg3-v3hh (maxTotalMergeKeys does not bound CPU); >=4.0.0 <4.3.2',
  },
  {
    name: 'hono',
    minVersion: '4.13.5',
    severity: 'moderate',
    advisory:
      'GHSA-gqvv-2mrq-wpjv (toSSG path traversal), GHSA-g6gw-c38x-mqfc ' +
      '(parseBody memory exhaustion), GHSA-crvj-82cr-hjcx (query-parser cache-key ' +
      'differential); <=4.13.4. Reached through @modelcontextprotocol/sdk',
  },
]

/**
 * Packages that must not be in the shipping tree at all, because we do not use
 * them and every version carries an open advisory.
 */
const NOT_SHIPPED: Array<{ name: string; why: string }> = [
  {
    name: 'nodemailer',
    why:
      'Unused: no import anywhere in the repo, and auth is Google OAuth + passkeys, not ' +
      'the next-auth Email provider. It is an OPTIONAL peer of both next-auth and ' +
      '@auth/core (peerDependenciesMeta.nodemailer.optional), so nothing needs it ' +
      'installed. Every version <=9.1.0 carries four advisories (GHSA-2x7j-588g-ccc2 ' +
      'quadratic-time DoS in addressparser, GHSA-wmmp-3585-3rmp and GHSA-cc9r-2j5m-2m83 ' +
      'recipient-domain validation bypasses, GHSA-8m3c-c648-2xjj disableFileAccess ' +
      'bypass), and 9.0.5 also violated its own peer range. Re-add it only alongside ' +
      'code that actually sends mail.',
  },
]

describe('AWTD-909: the shipping dependency tree clears every advisory floor we have met', () => {
  it('uses a lockfile shape this test understands', () => {
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2)
    expect(Object.keys(lock.packages).length).toBeGreaterThan(0)
  })

  for (const { name, minVersion, severity, advisory } of ADVISORY_FLOORS) {
    it(`ships ${name} >= ${minVersion} (${severity}: ${advisory.split(';')[0]})`, () => {
      const installs = entriesFor(name).filter(([, entry]) => shipped(entry))

      expect(
        installs.length,
        `${name} is no longer in the production tree at all. If that is deliberate, ` +
          `move it from ADVISORY_FLOORS to NOT_SHIPPED with the reason; do not delete ` +
          `the entry, or the next reader loses the advisory history.`
      ).toBeGreaterThan(0)

      for (const [path, entry] of installs) {
        const version = entry.version ?? '0.0.0'
        expect(
          compareVersions(version, minVersion),
          `${path} ships ${name}@${version}, which is covered by ${advisory}.\n` +
            `Required: >= ${minVersion}. Run \`npm install\` to refresh ${LOCKFILE}, ` +
            `and if the declared range forbids the patched version, widen the range ` +
            `rather than lowering this floor.`
        ).toBeGreaterThanOrEqual(0)
      }
    })
  }

  for (const { name, why } of NOT_SHIPPED) {
    it(`does not ship ${name} at all`, () => {
      const installs = entriesFor(name).filter(([, entry]) => shipped(entry))
      expect(
        installs.map(([path, entry]) => `${path}@${entry.version}`),
        `${name} is back in the production tree.\n${why}`
      ).toEqual([])
    })
  }
})
