import { describe, it, expect } from 'vitest'
import { formatFailureOutput } from '@/scripts/predeploy-self-healing'

describe('formatFailureOutput', () => {
  it('strips ANSI escape codes', () => {
    const raw = '\x1B[31mError:\x1B[0m something failed'
    expect(formatFailureOutput(raw)).toBe('Error: something failed')
  })

  it('extracts only tsc error lines when tsc-shaped output is detected', () => {
    const raw = [
      'Compiling project...',
      'app/api/foo/route.ts(12,5): error TS2345: bad type',
      "  Type 'string' is not assignable to type 'number'.",
      'lib/bar.ts(99,1): error TS2304: name not found',
      'Some unrelated trailing log',
    ].join('\n')
    const out = formatFailureOutput(raw)
    expect(out).toContain('app/api/foo/route.ts(12,5): error TS2345')
    expect(out).toContain('lib/bar.ts(99,1): error TS2304')
    expect(out).not.toContain('Compiling project')
    expect(out).not.toContain('Some unrelated trailing log')
  })

  it('keeps both head and tail for non-tsc output longer than the budget', () => {
    const head = 'STARTING TEST RUN ===\n'
    const middle = 'noise\n'.repeat(2000)
    const tail = '\n=== FAILURE SUMMARY ===\nTests 3 failed | 100 passed\n❯ tests/foo.test.ts > should X'
    const raw = head + middle + tail
    const out = formatFailureOutput(raw)
    expect(out).toContain('STARTING TEST RUN')
    expect(out).toContain('FAILURE SUMMARY')
    expect(out).toContain('Tests 3 failed')
    expect(out).toContain('middle truncated')
  })

  it('returns full output when shorter than the budget', () => {
    const raw = 'short failure message'
    expect(formatFailureOutput(raw)).toBe(raw)
  })

  it('preserves vitest failure summary at the end', () => {
    const noise = 'stdout | tests/x.test.ts\nblah blah\n'.repeat(500)
    const summary = `
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
 FAIL  tests/auth.test.ts > should reject bad creds
AssertionError: expected 401 but got 200
 Test Files  1 failed | 183 passed (184)
      Tests  1 failed | 2370 passed (2371)`
    const raw = noise + summary
    const out = formatFailureOutput(raw)
    expect(out).toContain('FAIL  tests/auth.test.ts')
    expect(out).toContain('AssertionError')
    expect(out).toContain('1 failed | 2370 passed')
  })
})
