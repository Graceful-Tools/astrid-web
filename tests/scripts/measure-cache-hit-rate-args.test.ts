/**
 * The `vercel logs` invocation this script uses has to be one the CLI accepts.
 *
 * Task 2b89739c parked waiting on a production deploy carrying `fde146f0`, then
 * a run of this script. The deploy has since happened — `fde146f0` is an
 * ancestor of the commit production reports at /api/health — so the run was due
 * on 2026-09-19. It failed before reading a single log line:
 *
 *   $ npx tsx scripts/measure-cache-hit-rate.ts --hours 24
 *   Error: unknown or unexpected option: --yes
 *   vercel logs failed: Command failed: vercel logs https://astrid.cc \
 *     --since 24h --json --yes --token ***
 *
 * `--yes` skips a confirmation PROMPT. `vercel logs` does not prompt — it is a
 * read-only query — and the current CLI rejects the flag outright rather than
 * ignoring it. So the one command whose entire purpose was to produce the
 * number could never produce it, and the failure was invisible until the
 * recheck date arrived.
 *
 * This pins the argument list rather than the output, because the output needs
 * production and a warm fleet, while the arguments are what was actually wrong.
 */
import { describe, expect, it } from 'vitest'
import { logsArgs } from '@/scripts/measure-cache-hit-rate'

describe('measure-cache-hit-rate vercel arguments (task 2b89739c)', () => {
  it('does not pass --yes, which the CLI rejects on a logs query', () => {
    expect(logsArgs(24)).not.toContain('--yes')
  })

  it('asks for the production deployment as JSON over the requested window', () => {
    const args = logsArgs(24)
    expect(args[0]).toBe('logs')
    expect(args).toContain('https://astrid.cc')
    expect(args).toContain('--json')
    expect(args[args.indexOf('--since') + 1]).toBe('24h')
  })

  it('carries the window it was given rather than a fixed one', () => {
    // The thin-sample floor is widened by raising --hours, so this argument
    // reaching the CLI is the whole remedy for a sample too small to report.
    expect(logsArgs(72)[logsArgs(72).indexOf('--since') + 1]).toBe('72h')
  })

  it('appends the token only when there is one', () => {
    // Pass the token explicitly rather than comparing against a no-argument
    // call: the default reads VERCEL_TOKEN, which .env.local actually sets, so
    // `logsArgs(24)` already carries a real token on a developer machine.
    expect(logsArgs(24, 'tok_123').slice(-2)).toEqual(['--token', 'tok_123'])
    // Omitting the argument deliberately falls back to VERCEL_TOKEN, so the
    // "no token" case is an explicit empty one. An empty string is not a
    // token; passing `--token ''` authenticates as nobody.
    expect(logsArgs(24, '')).not.toContain('--token')
  })
})
