// @vitest-environment node
/**
 * ADEV-291: check:unimported skipped every dot directory, so it never walked
 * app/.well-known and reported the modules those routes import as test-only.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'

describe('check:unimported walks app/.well-known (ADEV-291)', () => {
  it('does not report modules imported by the .well-known routes as test-only', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/check-unimported.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(out).not.toContain('lib/oauth/discovery-base-url.ts')
    expect(out).not.toContain('lib/brand/apple-app-site-association.ts')
  }, 60_000)
})
