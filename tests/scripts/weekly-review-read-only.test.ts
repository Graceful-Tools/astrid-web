import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('weekly review safety', () => {
  it('AWTD-hygiene remains read-only', () => {
    const source = readFileSync(join(root, 'scripts/weekly-review.ts'), 'utf8')

    expect(source).not.toMatch(/\.(?:update|updateMany|delete|deleteMany|create)\s*\(/)
    expect(source).toContain('pending cleanup')
  })

  it('keeps mutation behind an explicit apply flag in the maintenance command', () => {
    const source = readFileSync(join(root, 'scripts/expire-stale-auth-records.ts'), 'utf8')

    expect(source).toContain("process.argv.includes('--apply')")
    expect(source).toContain('updateMany')
  })
})
