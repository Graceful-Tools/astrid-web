/**
 * AWTD-1406 — agent-queue-status.ts on Windows printed `LANES: not read — `
 * with nothing after the dash, then crashed.
 *
 * The lane sweep was spawned as `spawnSync('npx', …)` with no shell. On
 * Windows npx is `npx.cmd`, which Node will not spawn that way, so the child
 * never started: status null, stderr empty, and the reason was the last line
 * of an empty string. These pin a launch that needs no shell on any platform
 * and a reason that is never blank.
 */

import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { tsxInvocation, spawnFailureReason } from '@/scripts/lib/spawn-tsx'

describe('tsxInvocation (AWTD-1406)', () => {
  it('runs tsx through the current node, not through npx', () => {
    const { command, args } = tsxInvocation('scripts/ready-tasks.ts', ['web', '--json'], '/repo')
    expect(command).toBe(process.execPath)
    expect(command).not.toMatch(/npx/)
    expect(args).toEqual([join('/repo', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/ready-tasks.ts', 'web', '--json'])
  })
})

describe('spawnFailureReason (AWTD-1406)', () => {
  it('uses the last line the child wrote to stderr', () => {
    expect(spawnFailureReason({ status: 1, signal: null, stderr: 'warming up\nboard not found\n' })).toBe('board not found')
  })

  it('names the spawn error when the child never started', () => {
    const error = Object.assign(new Error('spawnSync npx ENOENT'), { code: 'ENOENT' })
    expect(spawnFailureReason({ status: null, signal: null, stderr: '', error })).toBe('spawnSync npx ENOENT')
  })

  it('names the signal or the exit status when there is nothing else', () => {
    expect(spawnFailureReason({ status: null, signal: 'SIGKILL', stderr: '' })).toBe('killed by SIGKILL')
    expect(spawnFailureReason({ status: 2, signal: null, stderr: null })).toBe('exit 2')
  })

  it('is never blank', () => {
    expect(spawnFailureReason({ status: null, signal: null, stderr: '\n\n' })).not.toBe('')
  })
})
