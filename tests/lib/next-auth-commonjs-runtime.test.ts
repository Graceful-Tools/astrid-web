/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('AITD-447 hosted MCP authentication module startup', () => {
  it('loads the unmocked NextAuth dependency without experimental require(ESM)', () => {
    expect(() => execFileSync(process.execPath, [
      '--no-experimental-require-module',
      '-e',
      'require("next-auth"); require("next-auth/jwt")',
    ], { encoding: 'utf8', stdio: 'pipe' })).not.toThrow()
  })
})
