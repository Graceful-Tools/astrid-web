/**
 * Launch a repo script under tsx from another script, on every platform.
 *
 * `spawnSync('npx', ['tsx', …])` without a shell never starts on Windows: npx
 * is `npx.cmd` there, and Node will not spawn a .cmd file without one. Running
 * tsx's CLI through the current node needs no shell and no PATH lookup
 * (AWTD-1406).
 */

import { join } from 'node:path'

export function tsxInvocation(
  script: string,
  args: string[],
  repoRoot: string = process.cwd(),
): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args],
  }
}

/**
 * Why a spawned script failed, in one line that is never blank. A child that
 * never started writes no stderr, and an empty reason is how AWTD-1406's
 * report read `LANES: not read — ` with nothing after the dash.
 */
export function spawnFailureReason(result: {
  status: number | null
  signal: NodeJS.Signals | string | null
  stderr: string | null
  error?: Error
}): string {
  const lastLine = (result.stderr ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .pop()
  if (lastLine) return lastLine
  if (result.error?.message) return result.error.message
  if (result.signal) return `killed by ${result.signal}`
  if (result.status !== null) return `exit ${result.status}`
  return 'the process ended without an exit status, a signal or any output'
}
