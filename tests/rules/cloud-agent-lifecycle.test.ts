import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const read = (path: string) => readFileSync(path, 'utf8')

describe('cloud agent lifecycle wiring', () => {
  it('AWTD-1383: keeps live Copilot activation checks out of pull-request setup validation', () => {
    const workflow = yaml.load(read('.github/workflows/copilot-setup-steps.yml'))
    const steps = workflow.jobs['copilot-setup-steps'].steps
    const activation = steps.find((step: { name?: string }) => step.name === 'Verify polling activation without mutating tasks')
    expect(activation.if).toBe("github.event_name != 'pull_request'")
    expect(activation.run).toContain('--require-polling')
    expect(activation.run).toContain('--dry-run --no-write-seen')
    expect(activation['continue-on-error']).toBeUndefined()
    expect(steps.find((step: { name?: string }) => step.name === 'Build Astrid MCP transport').if).toBeUndefined()
  })
  it('keeps workers production-free with bounded runs and durable outcomes', () => {
    const source = read('.github/workflows/agent-run.yml')
    const workflow = yaml.load(source)
    expect(workflow.permissions.actions).toBe('read')
    expect(workflow.jobs.run.environment).toBe('agent')
    expect(workflow.jobs.run['timeout-minutes']).toBe(90)
    expect(source).toContain('--require-polling')
    expect(source).toContain('--include-unassigned')
    expect(source).toContain('--no-write-seen')
    expect(source).toContain('--seen-keys-file .agent-output/wake-keys.json')
    expect(source).toContain('actions/cache/save@')
    expect(source).toContain('restore-cloud-wake-state.ts')
    expect(source).toContain('release-stuck-doing.ts --agent')
    expect(source).toContain('--cloud-agent "${AGENT}"')
    expect(source).not.toContain('land-and-deploy.ts')
    expect(source).toContain('mcp__astrid__*')
  })
  it('AWTD-1363: runs on a schedule, and a scheduled run (no inputs) is a claude-code run', () => {
    const source = read('.github/workflows/agent-run.yml')
    const workflow = yaml.load(source)
    expect(workflow.on.schedule).toEqual([{ cron: '5,35 * * * *' }])
    // A schedule event carries no inputs: every read of the harness must default,
    // or the run names no harness and neither Run step's `if` matches.
    expect(source).not.toMatch(/inputs\.harness(?! \|\| 'claude-code')/)
    expect(workflow.jobs.run.env.ASTRID_FIXALL_HARNESS).toBe("${{ (inputs.harness || 'claude-code') }}")
  })
  it('fails the run when the agent itself reports it did not finish', () => {
    // Smoke test 2 (AWTD-1366) pushed its branch, could not open the PR
    // ("Resource not accessible by personal access token"), said RESULT: PARTIAL,
    // and the job still went green, so the Actions list showed a working loop.
    const source = read('.github/workflows/agent-run.yml')
    const steps = yaml.load(source).jobs.run.steps
    for (const name of ['Run Claude Code', 'Run Codex']) {
      const step = steps.find((s: { name?: string }) => s.name === name)
      expect(step.run, name).toContain('tee .agent-output/agent-transcript.txt')
      expect(step.run, name).toContain('set -o pipefail')
    }
    const verdict = steps.find((s: { name?: string }) => s.name === "Fail the run unless the agent reports OK or SKIPPED")
    expect(verdict).toBeDefined()
    expect(verdict.run).toContain('RESULT: OK')
    expect(verdict.run).toContain('RESULT: SKIPPED')
    expect(verdict.run).toContain('exit 1')
    expect(read('.github/agent-run-prompt.md')).toMatch(/^RESULT: OK \| SKIPPED \| PARTIAL \| FAILED/m)
  })
  it('gives deterministic shipping separate authority and an opt-in schedule', () => {
    const source = read('.github/workflows/agent-ship.yml')
    const workflow = yaml.load(source)
    expect(workflow.permissions.actions).toBe('write')
    expect(workflow.jobs.ship.environment).toBe('release')
    expect(workflow.on.workflow_dispatch.inputs.dry_run.default).toBe(true)
    expect(workflow.jobs.ship.if).toContain("vars.ASTRID_SHIP_ENABLED == 'true'")
    expect(source).toContain('--max-land 1')
    expect(source).not.toContain('--include-hand-opened')
    expect(source).not.toContain('--gate')
  })
  it('AWTD-1383: dispatches the built-in native Copilot bridge, never a replacement CLI worker', () => {
    const source = read('.github/workflows/native-copilot-bridge.yml')
    const workflow = yaml.load(source)
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.bridge.environment).toBe('copilot-bridge')
    expect(workflow.jobs.bridge.if).toContain("vars.ASTRID_NATIVE_COPILOT_ENABLED == 'true'")
    expect(workflow.on.workflow_dispatch.inputs.dry_run.default).toBe(true)
    expect(source).toContain('secrets.COPILOT_DISPATCH_TOKEN')
    expect(source).not.toContain('github.token')
    expect(read('.github/workflows/agent-run.yml')).not.toContain('COPILOT_GITHUB_TOKEN')
    expect(read('.github/workflows/agent-run.yml')).not.toContain('Run Copilot CLI')
  })
  it('refuses a main-ref race before production migrations without bypassing existing gates', () => {
    const source = read('.github/workflows/production-deployment.yml')
    expect(source.match(/test "\$\{EXPECTED_SHA\}" = "\$\{GITHUB_SHA\}"/g)).toHaveLength(2)
    expect(read('scripts/land-and-deploy.ts')).toContain('`expected_sha=${sha}`')
    expect(read('scripts/land-and-deploy.ts')).toContain("'--match-head-commit', pr.headRefOid")
  })
})
