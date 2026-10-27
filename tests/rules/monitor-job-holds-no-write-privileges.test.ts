/**
 * The deployment monitor reports. It does not write to the repo, and it holds
 * its production token from the `production` environment rather than from a repo
 * secret.
 *
 * `monitor-deployments.yml` used to end with an "Auto-commit fixes" step:
 *
 *     git add .
 *     git commit -m "fix: auto-apply deployment issue fixes"
 *     git push
 *
 * on every push to `main` and on an hourly cron, with `apply_fixes` defaulting
 * to true. `git add .` commits whatever is in the tree — not a reviewed diff —
 * straight onto the branch production deploys from. That was the one path by
 * which content nobody read could reach `main` and be shipped by a later
 * deploy. It never fired once (`git log --author="GitHub Action"` on main is
 * empty), so removing it cost no capability.
 *
 * The `environment: production` declaration is the other half (task bd1e0daa).
 * `VERCEL_TOKEN` was a repo-level secret, readable by any workflow in the repo
 * including ones running code an agent just wrote — and with it you do not need
 * `actions: write` to reach production, because `vercel deploy --prod` goes
 * straight to Vercel. An environment secret is released only to a job that
 * declares the environment, and this environment admits only `main`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const WORKFLOW = '.github/workflows/monitor-deployments.yml'

/** Lines with the comments stripped, so a comment describing the old step passes. */
function instructions(source: string): string[] {
  return source
    .split('\n')
    .map(line => line.replace(/#.*$/, ''))
    .filter(line => line.trim().length > 0)
}

describe('monitor-deployments.yml holds no write privileges (task bd1e0daa)', () => {
  const source = readFileSync(WORKFLOW, 'utf8')
  const lines = instructions(source)

  it('does not commit or push', () => {
    const writes = lines.filter(line => /\bgit\s+(push|commit|add)\b/.test(line))
    expect(writes).toEqual([])
  })

  it('takes VERCEL_TOKEN from the production environment, not a repo secret', () => {
    // The environment only releases its secrets to a job that declares it, and
    // its branch policy admits only `main`.
    expect(lines.some(line => /^\s*environment:\s*production\s*$/.test(line))).toBe(true)
  })

  it('still monitors — this is about privileges, not about removing the job', () => {
    expect(source).toMatch(/monitor:vercel/)
    expect(lines.some(line => /VERCEL_TOKEN/.test(line))).toBe(true)
  })
})
