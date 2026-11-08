/**
 * The signed-in e2e script turns its own projects on (2026-11-08).
 *
 * `authenticated-critical` and `authenticated-ui` exist only when
 * PLAYWRIGHT_AUTHENTICATED=1 (playwright.config.ts). The script did not set it,
 * so run bare it matched no project, and a scheduled agent — whose sandbox
 * allows `npm run *` but no environment prefix — could not run signed-in e2e at
 * all: AWTD-1538 was handed back twice for exactly that (runs 42210143396,
 * 42269989887, 42312120117).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>

describe('signed-in e2e is runnable as a bare npm script', () => {
  it('test:e2e:authenticated-critical sets PLAYWRIGHT_AUTHENTICATED=1 itself', () => {
    expect(scripts['test:e2e:authenticated-critical']).toMatch(/^PLAYWRIGHT_AUTHENTICATED=1 playwright test /)
  })
})
