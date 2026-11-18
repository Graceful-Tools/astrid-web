/**
 * ADEV-103: a fork must not run Astrid's own workflows.
 *
 * A fork inherits `.github/workflows/`, schedules included. `agent-run.yml` woke on an
 * unconditional `5,35` cron, and WHITELABELING.md told forks to delete four workflows
 * while missing the ones that actually ran on a timer. So every job in an owner-only
 * workflow is gated on the repository owner, and a workflow that gains a schedule has
 * to be classed here as owner-only or fork-safe before it lands.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const ROOT = process.cwd()
const WORKFLOW_DIR = join(ROOT, '.github/workflows')
const OWNER_GATE = "github.repository_owner == 'Graceful-Tools'"

/** Workflows that drive Astrid's loops, watch Astrid's deployments or publish Astrid's packages. */
const OWNER_ONLY = [
  'agent-run.yml',
  'agent-ship.yml',
  'astrid-coding-agent.yml',
  'copilot-setup-steps.yml',
  'fixall.yml',
  'fixstuff.yml',
  'monitor-deployments.yml',
  'native-copilot-bridge.yml',
  'publish-astrid-sdk.yml',
  'publish-openclaw-astrid-channel.yml',
]

/** Scheduled workflows that do something useful in any repository. */
const FORK_SAFE_SCHEDULED = [
  'auto-fix-vulnerabilities.yml', // npm audit fix on the fork's own tree
  'self-host.yml', // builds and smoke-tests the image from the fork's own tree
]

function load(name: string) {
  return yaml.load(readFileSync(join(WORKFLOW_DIR, name), 'utf8')) as {
    on?: Record<string, unknown>
    jobs: Record<string, { if?: string }>
  }
}

/** The job condition with `${{ }}` and whitespace stripped. */
function condition(raw: string | undefined): string {
  return (raw ?? '').replace(/^\s*\$\{\{\s*/, '').replace(/\s*\}\}\s*$/, '').replace(/\s+/g, ' ').trim()
}

describe('owner-only workflows run nothing in a fork (ADEV-103)', () => {
  it.each(OWNER_ONLY)('ADEV-103: every job in %s is gated on the repository owner', name => {
    const { jobs } = load(name)
    expect(Object.keys(jobs).length).toBeGreaterThan(0)
    for (const [job, spec] of Object.entries(jobs)) {
      const cond = condition(spec.if)
      // A leading conjunct, so no `||` elsewhere in the expression can bypass it. A gate
      // only on the root job is not enough: a downstream job with `always()` still runs.
      expect(cond === OWNER_GATE || cond.startsWith(`${OWNER_GATE} && `), `${name} → ${job}: ${cond}`).toBe(true)
      if (cond !== OWNER_GATE) {
        const rest = cond.slice(OWNER_GATE.length + 4)
        const topLevelOr = rest.split('').reduce(
          (state, ch, i) => {
            if (ch === '(') state.depth++
            else if (ch === ')') state.depth--
            else if (state.depth === 0 && rest.slice(i, i + 2) === '||') state.found = true
            return state
          },
          { depth: 0, found: false },
        ).found
        expect(topLevelOr, `${name} → ${job}: an unparenthesised || would bypass the gate`).toBe(false)
      }
    }
  })

  it('ADEV-103: every scheduled workflow is classed as owner-only or fork-safe', () => {
    const scheduled = readdirSync(WORKFLOW_DIR)
      .filter(name => /\.ya?ml$/.test(name))
      .filter(name => load(name).on && 'schedule' in (load(name).on as object))
    for (const name of scheduled) {
      expect(
        OWNER_ONLY.includes(name) || FORK_SAFE_SCHEDULED.includes(name),
        `${name} has a schedule: add it to OWNER_ONLY (and gate it) or FORK_SAFE_SCHEDULED`,
      ).toBe(true)
    }
  })

  it('ADEV-103: WHITELABELING.md names every owner-only workflow', () => {
    const doc = readFileSync(join(ROOT, 'docs/WHITELABELING.md'), 'utf8')
    for (const name of OWNER_ONLY) expect(doc, name).toContain(`\`${name}\``)
  })
})
