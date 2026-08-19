/**
 * A failed fetch is not a clean bill of health (task aee6ce0d).
 *
 * Reproduced live during a hygiene review. `npm run monitor:vercel:no-fix` in a
 * checkout without the Vercel CLI printed:
 *
 *     ❌ Failed to fetch deployments: /bin/sh: vercel: command not found
 *     ✅ No failed deployments found!
 *     ✅ Found 2 deployment issue task(s) - marking as resolved
 *
 * A hard failure reported as healthy, and then the script WROTE TO THE BOARD on
 * the strength of it. getRecentDeployments() caught every error and returned
 * `[]`, so an unfetchable list became indistinguishable from an empty one.
 *
 * The stakes are in the workflow, not the console: monitor-deployments.yml runs
 * this on every push to main and hourly on cron. An expired VERCEL_TOKEN, a
 * Vercel outage, or an output-format change on any `vercel@latest` bump all
 * produce this same path — so a genuinely failed production deployment is
 * reported healthy, the tasks tracking it are auto-closed, and the step exits 0
 * so nobody is told.
 *
 * Two separate defects are pinned here, and they fail independently:
 *   1. cannot-fetch must not be read as nothing-failed;
 *   2. `--no-fix` must not write to the board. It suppressed CODE fixes only,
 *      so a read-only audit posted comments to two real tasks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VercelLogMonitor } from '../../scripts/monitor-vercel-logs'

let monitor: VercelLogMonitor
let resolveSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.exitCode = undefined
  monitor = new VercelLogMonitor()
  resolveSpy = vi.spyOn(monitor, 'resolveDeploymentTasks').mockResolvedValue(undefined)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('monitor() when Vercel cannot be reached', () => {
  beforeEach(() => {
    // What a missing CLI / expired token / Vercel outage now looks like.
    vi.spyOn(monitor, 'getRecentDeployments').mockResolvedValue(null)
  })

  it('does not resolve deployment tasks on a fetch it never made', async () => {
    await monitor.monitor(true)

    expect(
      resolveSpy,
      'the board was written to on the strength of a failed fetch',
    ).not.toHaveBeenCalled()
  })

  it('exits non-zero so the Actions step goes red instead of silently green', async () => {
    await monitor.monitor(true)

    expect(process.exitCode).not.toBe(0)
    expect(process.exitCode).toBeGreaterThan(0)
  })

  it('does not claim the deployments are healthy', async () => {
    const log = vi.spyOn(console, 'log')
    await monitor.monitor(true)

    const said = log.mock.calls.flat().join(' ')
    expect(said).not.toContain('No failed deployments found')
  })
})

describe('monitor() with --no-fix', () => {
  it('does not write to the board even when deployments are healthy', async () => {
    // --no-fix is an audit. It suppressed code fixes only, so a read-only run
    // still commented on and completed real tasks.
    vi.spyOn(monitor, 'getRecentDeployments').mockResolvedValue([])

    await monitor.monitor(false)

    expect(resolveSpy, '--no-fix mutated the task board').not.toHaveBeenCalled()
  })
})

describe('monitor() on a healthy fetch', () => {
  it('still resolves deployment tasks when fixes are enabled', async () => {
    // The guard must not disable the feature it is guarding.
    vi.spyOn(monitor, 'getRecentDeployments').mockResolvedValue([])

    await monitor.monitor(true)

    expect(resolveSpy).toHaveBeenCalledTimes(1)
    expect(process.exitCode ?? 0).toBe(0)
  })
})
