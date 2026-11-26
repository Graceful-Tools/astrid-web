// @vitest-environment node
// ADEV-290: check:risk-controls must flag a plain vitest it.skip('title', fn).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const repo = path.resolve(__dirname, '../..')
const dir = path.join(repo, 'tests', 'tmp-adev-290')

function run(body: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'fixture.test.ts'), body)
  try {
    execFileSync('npx', ['tsx', 'scripts/check-test-risk-controls.ts'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return ''
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string }
    return `${err.stderr ?? ''}${err.stdout ?? ''}`
  }
}

describe('check-test-risk-controls skip classification (ADEV-290)', () => {
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('flags it.skip with a title string', () => {
    expect(run(`it.skip('title', () => {})\n`)).toContain('fixture.test.ts:1')
  })

  it('flags describe.skip', () => {
    expect(run(`describe.skip('x', () => {})\n`)).toContain('fixture.test.ts:1')
  })

  it('allows a conditional test.skip(condition, reason)', () => {
    expect(run(`test.skip(browserName !== 'chromium', 'reason')\n`)).not.toContain('fixture.test.ts')
  })

  it('flags an it.todo that names no task, allows one that does', () => {
    expect(run(`it.todo('someday')\n`)).toContain('fixture.test.ts:1')
    expect(run(`it.todo('AWTD-1554 follow-up')\n`)).not.toContain('fixture.test.ts')
  })

  it('allows describe.skip inside a ternary', () => {
    expect(run(`(cond ? describe : describe.skip)('x', () => {})\n`)).not.toContain('fixture.test.ts')
  })
})
