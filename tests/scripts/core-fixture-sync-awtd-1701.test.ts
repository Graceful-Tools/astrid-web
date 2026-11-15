/**
 * AWTD-1701: a web contract change must not leave astrid-core's copied fixtures stale.
 *
 * Core also owns fixtures web does not generate (board-rows.json, waiting.json...), so only
 * the files web has are compared. A core-only file is never "stale" and never deleted.
 */
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
