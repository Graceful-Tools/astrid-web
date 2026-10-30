/**
 * AWTD-1393: repo scripts build their database client in ONE place.
 *
 * Prisma 7 stops connecting by itself — every `PrismaClient` needs a driver
 * adapter passed to its constructor — and when that task was filed, 80 files
 * under scripts/ each called `new PrismaClient()` directly. The upgrade would
 * have been 80 edits, each one a chance to point a script at the wrong pool.
 *
 * So scripts call `createScriptPrisma()` from scripts/lib/script-prisma.ts, and
 * the adapter goes in there once. `npm run check:reuse` already lists scripts/
 * under `direct-prisma-client`, but that support-code report never blocks — this
 * is the check that does.
 *
 * The factory takes the target URL from its caller and never imports the
 * lib/prisma app singleton: operational scripts choose their database on
 * purpose (scripts/lib/database-target.ts), and a shared client must not
 * quietly choose it for them.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'

const FACTORY = 'scripts/lib/script-prisma.ts'

/**
 * check-reuse.ts holds the rule's own pattern; *.md files describe it.
 * scripts/archive/ is excluded from tsconfig and from every gate.
 */
const NOT_A_CONSTRUCTOR = new Set([FACTORY, 'scripts/check-reuse.ts'])

/**
 * Plain-node CommonJS one-offs that cannot require a .ts module, all listed as
 * unreferenced in docs/SCRIPT_INVENTORY.md. The Prisma 7 follow-up archives or
 * converts them. Shrink-only: never add a file here.
 */
const LEGACY_JS = new Set<string>([
  // Empty since AWTD-1408 archived the last five. Shrink-only: never add to it.
])

function constructorSites(): string[] {
  const out = execFileSync(
    'git',
    ['grep', '-n', '-F', 'new PrismaClient(', '--', 'scripts', ':!scripts/archive', ':!*.md'],
    { encoding: 'utf8' }
  ).toString()
  return out
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      const file = line.split(':')[0]
      return !NOT_A_CONSTRUCTOR.has(file) && !LEGACY_JS.has(file)
    })
}

describe('scripts build PrismaClient through the factory (AWTD-1393)', () => {
  it('no script under scripts/ constructs its own PrismaClient', () => {
    let sites: string[]
    try {
      sites = constructorSites()
    } catch {
      // git grep exits 1 when nothing matches, which is the passing case.
      sites = []
    }
    expect(sites).toEqual([])
  })

  it('the legacy JS allowlist only shrinks', () => {
    for (const file of LEGACY_JS) {
      expect(existsSync(file), `${file} is gone: remove it from LEGACY_JS`).toBe(true)
    }
  })

  it('the factory never reaches for the app singleton', () => {
    const source = readFileSync(FACTORY, 'utf8')
    expect(source).not.toMatch(/from ['"](@\/|\.\.\/\.\.\/)lib\/prisma['"]/)
    expect(source).toContain('new PrismaClient(')
  })
})
