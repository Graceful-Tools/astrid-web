import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('brand audit output capture (AWTD-1562)', () => {
  it('captures child stdout and stderr instead of forwarding profile values to the terminal', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/brand-audit.ts'), 'utf8')
    expect(source).toMatch(/stdio:\s*\[\s*'pipe',\s*'pipe',\s*'pipe'\s*\]/)
  })
})
