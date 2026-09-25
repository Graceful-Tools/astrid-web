/**
 * AWTD-914: the production advisory audit must be able to SEE a finding.
 *
 * `scripts/audit-production-advisories.ts` answers the weekly question "is
 * anything we ship carrying a known advisory?" — and the overwhelmingly common
 * answer is "no". That makes it the dangerous kind of tool: a broken version of
 * it produces exactly the same output as a working one, week after week, and the
 * only way to find out it was broken is the way AWTD-909 found out, when two
 * critical unauthenticated RCEs turned out to have been live for weeks behind a
 * reassuring weekly "nothing to report".
 *
 * The script's own `selfCheck()` covers the network half at runtime: it asks
 * about a version whose advisories are known and exits `UNKNOWN` rather than
 * `clean` if they do not come back. This file covers the half a canary cannot —
 * the offline logic that decides WHICH packages get asked about and which
 * answers count as hits. Those can fail silently without any network involved:
 * an empty production tree asks about nothing and is told nothing.
 *
 * No network here, deliberately. These run in `npm run predeploy`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  productionTree,
  findingsFor,
  countBySeverity,
  packageNameFor,
  satisfiesRange,
  compareVersions,
  UnparseableRangeError,
  type Advisory,
  type BulkResponse,
} from '../../scripts/audit-production-advisories'

const lock = JSON.parse(
  readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')
)

function advisory(over: Partial<Advisory> = {}): Advisory {
  return {
    id: 1,
    url: 'https://github.com/advisories/GHSA-test',
    title: 'Test advisory',
    severity: 'critical',
    vulnerable_versions: '<99.0.0',
    ...over,
  }
}

describe('AWTD-914: the advisory audit can see what it claims to check', () => {
  const tree = productionTree(lock)

  it('builds a production tree that is not empty', () => {
    // An empty tree queries nothing, is told nothing, and reports CLEAN.
    expect(tree.size).toBeGreaterThan(100)
  })

  it('includes packages that really do ship', () => {
    for (const name of ['next', 'react', '@prisma/client']) {
      expect(tree.has(name), `${name} should be in the shipping tree`).toBe(true)
    }
  })

  it('excludes dev-only packages, so the dev toolchain cannot drown the signal', () => {
    // The whole point of `--omit=dev`: a high in vitest must not read like one in next.
    for (const name of ['vitest', 'eslint']) {
      expect(tree.has(name), `${name} is dev-only and must not be audited`).toBe(false)
    }
  })

  it('keeps sharp, which reaches production through an optional branch', () => {
    // `devOptional` counts as shipping — the optional branch installs on Vercel.
    // AWTD-909: sharp did not follow next past an override floor it already met.
    expect(tree.has('sharp')).toBe(true)
  })

  it('records every install path for a package, not just the first', () => {
    for (const [, byVersion] of tree) {
      for (const [, paths] of byVersion) {
        expect(paths.length).toBeGreaterThan(0)
      }
    }
  })

  it('flags an installed version that an advisory range covers', () => {
    const affected = new Map([
      ['next', new Map([['16.3.2', ['node_modules/next']]])],
    ])
    const response: BulkResponse = {
      next: [advisory({ vulnerable_versions: '>=16.0.0 <16.3.3' })],
    }

    const findings = findingsFor(affected, response)

    expect(findings).toHaveLength(1)
    expect(findings[0].name).toBe('next')
    expect(findings[0].version).toBe('16.3.2')
    expect(findings[0].paths).toEqual(['node_modules/next'])
  })

  it('ignores an advisory whose range does NOT cover the installed version', () => {
    // The patched case. Getting this wrong the other way files phantom tasks
    // every week, which is its own way of making the report unreadable.
    const patched = new Map([
      ['next', new Map([['16.3.5', ['node_modules/next']]])],
    ])
    const response: BulkResponse = {
      next: [advisory({ vulnerable_versions: '>=16.0.0 <16.3.3' })],
    }

    expect(findingsFor(patched, response)).toEqual([])
  })

  it('flags only the vulnerable copy when one package is installed twice', () => {
    const mixed = new Map([
      [
        'js-yaml',
        new Map([
          ['4.3.1', ['node_modules/js-yaml']],
          ['4.3.2', ['node_modules/other/node_modules/js-yaml']],
        ]),
      ],
    ])
    const response: BulkResponse = {
      'js-yaml': [advisory({ vulnerable_versions: '>=4.0.0 <4.3.2', severity: 'high' })],
    }

    const findings = findingsFor(mixed, response)

    expect(findings.map(f => f.version)).toEqual(['4.3.1'])
  })

  it('ignores advisories for packages that are not in the shipping tree', () => {
    const response: BulkResponse = { 'not-installed-anywhere': [advisory()] }
    expect(findingsFor(tree, response)).toEqual([])
  })

  it('sorts findings worst-first, so a critical cannot hide under a low', () => {
    const affected = new Map([
      ['a-pkg', new Map([['1.0.0', ['node_modules/a-pkg']]])],
      ['b-pkg', new Map([['1.0.0', ['node_modules/b-pkg']]])],
    ])
    const response: BulkResponse = {
      'a-pkg': [advisory({ severity: 'low' })],
      'b-pkg': [advisory({ severity: 'critical' })],
    }

    const findings = findingsFor(affected, response)

    expect(findings.map(f => f.advisory.severity)).toEqual(['critical', 'low'])
  })

  it('counts by severity, which is what decides whether anything gets filed', () => {
    const affected = new Map([
      ['a-pkg', new Map([['1.0.0', ['node_modules/a-pkg']]])],
      ['b-pkg', new Map([['1.0.0', ['node_modules/b-pkg']]])],
    ])
    const response: BulkResponse = {
      'a-pkg': [advisory({ severity: 'critical' }), advisory({ severity: 'moderate' })],
      'b-pkg': [advisory({ severity: 'critical' })],
    }

    const counts = countBySeverity(findingsFor(affected, response))

    expect(counts.critical).toBe(2)
    expect(counts.moderate).toBe(1)
    expect(counts.high).toBe(0)
  })

  describe('advisory version ranges are matched, using the real ranges we have seen', () => {
    // Every range below is quoted from an advisory that actually covered this
    // repo's tree, recorded in tests/rules/production-tree-has-no-known-rce.
    it('matches the next RCE range that AWTD-909 missed', () => {
      expect(satisfiesRange('16.3.2', '>=16.0.0 <16.3.3')).toBe(true)
      expect(satisfiesRange('16.3.5', '>=16.0.0 <16.3.3')).toBe(false)
      expect(satisfiesRange('16.3.3', '>=16.0.0 <16.3.3')).toBe(false)
    })

    it('matches a bare upper bound, as sharp and hono advisories use', () => {
      expect(satisfiesRange('0.35.3', '<0.35.4')).toBe(true)
      expect(satisfiesRange('0.35.4', '<0.35.4')).toBe(false)
      expect(satisfiesRange('4.13.4', '<=4.13.4')).toBe(true)
      expect(satisfiesRange('4.13.5', '<=4.13.4')).toBe(false)
    })

    it('treats a comparator set as a conjunction and || as alternatives', () => {
      expect(satisfiesRange('2.5.0', '>=1.0.0 <2.0.0 || >=2.4.0 <3.0.0')).toBe(true)
      expect(satisfiesRange('2.2.0', '>=1.0.0 <2.0.0 || >=2.4.0 <3.0.0')).toBe(false)
    })

    it('sorts a prerelease below its release, so a canary of the fix is not "patched"', () => {
      expect(compareVersions('16.3.3-canary.1', '16.3.3')).toBeLessThan(0)
      expect(satisfiesRange('16.3.3-canary.1', '<16.3.3')).toBe(true)
    })

    it('compares numerically, not as strings', () => {
      // '9' > '10' as strings; this is the classic way a floor check goes quiet.
      expect(compareVersions('16.10.0', '16.9.0')).toBeGreaterThan(0)
      expect(satisfiesRange('16.10.0', '<16.9.0')).toBe(false)
    })

    it('accepts * as covering everything', () => {
      expect(satisfiesRange('1.2.3', '*')).toBe(true)
    })

    it('THROWS on a range it does not understand rather than saying "not vulnerable"', () => {
      // The whole safety property: an advisory we cannot parse must escalate to
      // UNKNOWN, never be discarded as inapplicable.
      expect(() => satisfiesRange('1.2.3', '^1.0.0')).toThrow(UnparseableRangeError)
      expect(() => satisfiesRange('1.2.3', '1.x')).toThrow(UnparseableRangeError)
      expect(() => satisfiesRange('1.2.3', '~1.0.0')).toThrow(UnparseableRangeError)
      expect(() => satisfiesRange('1.2.3', '1.0.0 - 2.0.0')).toThrow(
        UnparseableRangeError
      )
    })

    it('raises on an unparseable token even when an earlier one already failed', () => {
      // Regression: parsing used to happen inside every()/some(), so the bad
      // token in a hyphen range was reached only for versions that matched the
      // tokens before it. The same range then meant "not vulnerable" for 1.2.3
      // and raised for 1.0.0 — a silent discard that varied by version.
      expect(() => satisfiesRange('9.9.9', '1.0.0 - 2.0.0')).toThrow(
        UnparseableRangeError
      )
      expect(() => satisfiesRange('9.9.9', '>=1.0.0 <2.0.0 || ^3.0.0')).toThrow(
        UnparseableRangeError
      )
    })

    it('propagates that refusal out of findingsFor, so the run cannot report clean', () => {
      const tree = new Map([['a-pkg', new Map([['1.0.0', ['node_modules/a-pkg']]])]])
      const response: BulkResponse = {
        'a-pkg': [advisory({ vulnerable_versions: '^1.0.0' })],
      }

      expect(() => findingsFor(tree, response)).toThrow(UnparseableRangeError)
    })
  })

  describe('package names come off lockfile paths correctly', () => {
    it('reads a top-level package', () => {
      expect(packageNameFor('node_modules/next')).toBe('next')
    })

    it('reads a scoped package', () => {
      expect(packageNameFor('node_modules/@prisma/client')).toBe('@prisma/client')
    })

    it('reads the innermost name of a nested install', () => {
      // Getting this wrong yields a name the registry has never heard of, and
      // an advisory that is therefore never returned.
      expect(packageNameFor('node_modules/a/node_modules/js-yaml')).toBe('js-yaml')
    })

    it('returns null for the root entry rather than a bogus name', () => {
      expect(packageNameFor('')).toBeNull()
    })
  })
})
