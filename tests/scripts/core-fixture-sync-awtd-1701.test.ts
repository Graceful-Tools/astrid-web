/**
 * AWTD-1701: a web contract change must not leave astrid-core's copied fixtures stale.
 *
 * Core also owns fixtures web does not generate (board-rows.json, waiting.json...), so only
 * the files web has are compared. A core-only file is never "stale" and never deleted.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diffFixtureSets, refreshPullRequestBody } from '@/scripts/lib/core-fixture-sync'

describe('AWTD-1701 diffFixtureSets', () => {
  it('reports nothing when core carries the web fixtures byte for byte', () => {
    expect(diffFixtureSets({ 'a.json': '{}\n' }, { 'a.json': '{}\n' })).toEqual({ stale: [], missing: [] })
  })

  it('names a fixture whose content differs', () => {
    expect(
      diffFixtureSets({ 'agent-queue.json': 'new', 'b.json': 'x' }, { 'agent-queue.json': 'old', 'b.json': 'x' }),
    ).toEqual({ stale: ['agent-queue.json'], missing: [] })
  })

  it('names a fixture core does not have yet', () => {
    expect(diffFixtureSets({ 'new.json': 'x' }, {})).toEqual({ stale: [], missing: ['new.json'] })
  })

  it('ignores a core-owned fixture web does not generate', () => {
    expect(diffFixtureSets({ 'a.json': 'x' }, { 'a.json': 'x', 'waiting.json': 'core' })).toEqual({
      stale: [],
      missing: [],
    })
  })

  it('lists files sorted so the output is stable', () => {
    expect(diffFixtureSets({ 'z.json': '1', 'a.json': '1' }, { 'z.json': '0', 'a.json': '0' }).stale).toEqual([
      'a.json',
      'z.json',
    ])
  })
})

describe('AWTD-1701 refreshPullRequestBody', () => {
  it('names the files and the web commit', () => {
    const body = refreshPullRequestBody({ stale: ['agent-queue.json'], missing: ['x.json'] }, 'abc123')
    expect(body).toContain('agent-queue.json')
    expect(body).toContain('x.json')
    expect(body).toContain('abc123')
  })
})

describe('ADEV-325: the cloned checkout can push its refresh branch', () => {
  // Every ship tick on 2026-11-26 died at `git push` with "could not read Username":
  // `gh repo clone` leaves no credential helper, so core#129 and #131 stayed BLOCKED.
  it('ADEV-325: --clone sets gh as the git credential helper before pushing', () => {
    const src = readFileSync(resolve(__dirname, '../../scripts/sync-core-fixtures.ts'), 'utf8')
    const helper = src.indexOf("'credential.helper'")
    expect(helper).toBeGreaterThan(-1)
    expect(src.slice(helper, helper + 120)).toMatch(/gh auth git-credential/)
    expect(helper).toBeLessThan(src.indexOf("git('push'"))
  })
})
