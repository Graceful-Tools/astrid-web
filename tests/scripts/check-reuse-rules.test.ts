/**
 * Task bc27c00a — prove each check:reuse rule FIRES.
 *
 * A green run over a clean repository proves nothing about a rule. This script
 * already shipped a rule whose pattern contained a double quote, which ended
 * the shell argument early so grep matched nothing and the rule reported a
 * confident zero (found in task d818849d). docs/WHITELABELING.md:288 makes the
 * same point: a gate that is green for the wrong reason is worse than none.
 *
 * So every rule is run against a fixture tree with the violation deliberately
 * planted, and separately against a clean tree, and must distinguish them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let fixtureRoot: string
let cleanRoot: string

/** Files planted under the fixture root, keyed by the rule they must trip. */
const VIOLATIONS: Record<string, { path: string; content: string }> = {
  'inline-admin-check': {
    path: 'components/bad-admin.tsx',
    content: 'export const x = (list: any, u: any) => list.admins.some((a: any) => a.id === u.id)\n',
  },
  'inline-owner-check': {
    path: 'components/bad-owner.tsx',
    content: 'export const x = (list: any, u: any) => list.ownerId === u.id\n',
  },
  'hardcoded-add-task-copy': {
    path: 'components/bad-copy.tsx',
    content: 'export const x = <input placeholder="Add a task" />\n',
  },
  'hardcoded-brand-literal': {
    path: 'components/bad-brand.tsx',
    content: 'export const x = <p>Welcome to Astrid</p>\n',
  },
  'hardcoded-jsx-copy': {
    path: 'components/bad-jsx.tsx',
    content: 'export const x = <p>Some visible copy</p>\n',
  },
  'hardcoded-hex-colour': {
    path: 'components/bad-hex.tsx',
    content: 'export const x = { color: "#3b82f6" }\n',
  },
  'hardcoded-identity': {
    path: 'lib/bad-identity.ts',
    content: "export const OWNER = 'someone@gmail.com'\n",
  },
  'direct-prisma-client': {
    path: 'lib/bad-prisma.ts',
    content: "import { PrismaClient } from '@prisma/client'\nexport const db = new PrismaClient()\n",
  },
}

function run(root: string): Record<string, string[]> {
  const out = execFileSync(
    'npx',
    ['tsx', join(process.cwd(), 'scripts/check-reuse.ts'), '--json', '--root', root],
    { encoding: 'utf8', cwd: process.cwd() }
  )
  return JSON.parse(out).findings
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'reuse-dirty-'))
  cleanRoot = mkdtempSync(join(tmpdir(), 'reuse-clean-'))

  for (const root of [fixtureRoot, cleanRoot]) {
    for (const dir of ['components', 'app', 'hooks', 'lib', 'mcp', 'services', 'packages']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    // A file with nothing objectionable in it, so the clean run is not empty
    // for the trivial reason that grep had no files to read.
    writeFileSync(join(root, 'components/fine.tsx'), 'export const x = 1\n')
  }

  for (const { path, content } of Object.values(VIOLATIONS)) {
    mkdirSync(join(fixtureRoot, path.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(join(fixtureRoot, path), content)
  }
}, 120_000)

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
  rmSync(cleanRoot, { recursive: true, force: true })
})

describe('check:reuse rules actually fire (task bc27c00a)', () => {
  it.each(Object.keys(VIOLATIONS))('%s catches its planted violation', (ruleId) => {
    const findings = run(fixtureRoot)

    expect(findings, `rule "${ruleId}" is not defined`).toHaveProperty(ruleId)
    expect(
      findings[ruleId].join('\n'),
      `rule "${ruleId}" did not flag ${VIOLATIONS[ruleId].path}`
    ).toContain(VIOLATIONS[ruleId].path.split('/').pop())
  }, 120_000)

  it('reports nothing on a clean tree', () => {
    const findings = run(cleanRoot)

    for (const [ruleId, hits] of Object.entries(findings)) {
      expect(hits, `rule "${ruleId}" false-positives on clean source`).toEqual([])
    }
  }, 120_000)
})
