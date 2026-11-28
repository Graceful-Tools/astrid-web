import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// scripts/env-has.sh says whether a key is set without printing its value (2026-11-28 session analysis).
function run(file: string, ...keys: string[]) {
  try {
    return { code: 0, out: execFileSync('bash', ['scripts/env-has.sh', '--file', file, ...keys], { encoding: 'utf8' }) }
  } catch (error) {
    const e = error as { status: number; stdout: string }
    return { code: e.status, out: e.stdout }
  }
}

describe('scripts/env-has.sh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-has-'))
  const file = join(dir, 'env')
  writeFileSync(file, ['PLAIN=s3cret-value', 'export QUOTED="quoted-value"', 'EMPTY=', 'BLANK_QUOTES=""', '# COMMENTED=x'].join('\n'))

  it('reports set keys and never prints a value', () => {
    const { code, out } = run(file, 'PLAIN', 'QUOTED')
    expect(code).toBe(0)
    expect(out).toBe('PLAIN set\nQUOTED set\n')
    expect(out).not.toMatch(/s3cret|quoted-value/)
  })

  it('treats empty, blank-quoted, commented and absent keys as missing, and exits 1', () => {
    const { code, out } = run(file, 'EMPTY', 'BLANK_QUOTES', 'COMMENTED', 'ABSENT')
    expect(code).toBe(1)
    expect(out).toBe('EMPTY missing\nBLANK_QUOTES missing\nCOMMENTED missing\nABSENT missing\n')
  })

  it('refuses something that is not a key name', () => {
    expect(run(file, 'A.*').code).toBe(2)
  })
})
