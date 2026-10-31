import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorkflowStep, workflowStep } from '../utils/workflow-step'
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const read = (path: string) => readFileSync(path, 'utf8')
const AGENT_RUN = '.github/workflows/agent-run.yml'
const VERDICT = 'Fail the run unless the agent reports OK or SKIPPED'
const PRESERVE = 'Preserve unfinished work'

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
    // What the verdict and preserve steps DO is executed below; here, only
    // when they run, which executing the script cannot show.
    const verdict = steps.find((s: { name?: string }) => s.name === VERDICT)
    expect(verdict.if).toBe("${{ !inputs.dry_run && steps.preflight.outputs.work == 'true' }}")
    const preserve = steps.find((s: { name?: string }) => s.name === PRESERVE)
    expect(preserve.if).toBe("${{ always() && !inputs.dry_run && steps.preflight.outputs.work == 'true' }}")
    expect(read('.github/agent-run-prompt.md')).toMatch(/^RESULT: OK \| SKIPPED \| PARTIAL \| FAILED/m)
  })
  it('AWTD-1410: prepares the database once, with the real migrations', () => {
    // agent-setup pushed the schema and agent-run then ran `migrate deploy` on
    // the same database, which refuses a schema with no migration history
    // (P3005). Every scheduled run with work failed before the agent started.
    const setup = read('.github/actions/agent-setup/action.yml')
    expect(setup).toContain('prisma migrate deploy')
    expect(setup).not.toMatch(/^\s*npx prisma db push/m)
    const agentRun = read('.github/workflows/agent-run.yml')
    expect(agentRun).not.toMatch(/^\s*npx prisma (migrate deploy|db push)/m)
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

/**
 * AWTD-1424: the verdict and preserve-work steps, executed. Their job env
 * (ASTRID_FIXALL_HARNESS, GITHUB_RUN_ID) is supplied as the workflow would.
 */
describe('agent-run verdict step, executed', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-run-verdict-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const verdictFor = (transcript: string | null) => {
    if (transcript !== null) {
      mkdirSync(join(dir, '.agent-output'))
      writeFileSync(join(dir, '.agent-output', 'agent-transcript.txt'), transcript)
    }
    const output = join(dir, 'github-output')
    writeFileSync(output, '')
    return runWorkflowStep(workflowStep(AGENT_RUN, 'run', VERDICT), { cwd: dir, env: { GITHUB_OUTPUT: output } })
  }
  const verdictOutput = () => read(join(dir, 'github-output'))

  it.each([
    ['RESULT: OK — AWTD-1 merged-ready, PR #9\n'],
    ['RESULT: SKIPPED — nothing Ready\n'],
    ['RESULT: OK\n'],
  ])('passes when the agent reports %s', transcript => {
    expect(verdictFor(`working...\n${transcript}`).status).toBe(0)
  })

  it.each([
    ['PARTIAL', 'RESULT: PARTIAL — pushed, PR not opened\n'],
    ['FAILED', 'RESULT: FAILED — tests red\n'],
    ['no RESULT line', 'did some work and stopped\n'],
    ['RESULT only mid-line', 'I will print RESULT: OK at the end\n'],
    ['an empty transcript', ''],
    // AWTD-1424: the prompt's own format line once passed as a green run.
    ['the prompt template echoed back', 'RESULT: OK | SKIPPED | PARTIAL | FAILED\n'],
    ['a word that merely starts with OK', 'RESULT: OKAY\n'],
  ])('fails on %s', (_label, transcript) => {
    const result = verdictFor(transcript)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::The agent did not finish')
  })

  it.each([
    ['RESULT: OK — AWTD-1 merged-ready, PR #9\n', 'OK'],
    ['RESULT: SKIPPED — nothing Ready\n', 'SKIPPED'],
    ['RESULT: OK\n', 'OK'],
  ])('tells the chain job the verdict word for %s', (transcript, word) => {
    expect(verdictFor(transcript).status).toBe(0)
    expect(verdictOutput()).toBe(`result=${word}\n`)
  })

  it('fails when there is no transcript at all', () => {
    expect(verdictFor(null).status).toBe(1)
  })

  it('lets the LAST RESULT line decide', () => {
    expect(verdictFor('RESULT: OK\nmore work\nRESULT: PARTIAL — ran out of time\n').status).toBe(1)
    rmSync(join(dir, '.agent-output'), { recursive: true })
    expect(verdictFor('RESULT: FAILED\nretried\nRESULT: OK\n').status).toBe(0)
  })
})

describe('agent-run preserve-work step, executed', () => {
  let root: string
  let work: string
  let origin: string
  const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    ASTRID_FIXALL_HARNESS: 'claude-code', GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1' }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: work, env: { ...process.env, ...env }, encoding: 'utf8' }).trim()
  const remoteHeads = () =>
    execFileSync('git', ['--git-dir', origin, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'],
      { env: { ...process.env, ...env }, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const preserve = () => runWorkflowStep(workflowStep(AGENT_RUN, 'run', PRESERVE), { cwd: work, env })
  let base: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-run-preserve-'))
    work = join(root, 'work')
    origin = join(root, 'origin.git')
    mkdirSync(work)
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: { ...process.env, ...env } })
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Preserve test')
    git('config', 'user.email', 'preserve@example.test')
    git('config', 'commit.gpgsign', 'false')
    git('remote', 'add', 'origin', origin)
    // As in the repo: the run's own outputs are ignored, so the transcript
    // written by every run never reads as unfinished work.
    writeFileSync(join(work, '.gitignore'), '.agent-output/\n')
    writeFileSync(join(work, 'task.txt'), 'initial\n')
    git('add', '.')
    git('commit', '-qm', 'initial')
    git('push', '-q', '-u', 'origin', 'main')
    base = git('rev-parse', 'HEAD')
    mkdirSync(join(work, '.agent-output'))
    writeFileSync(join(work, '.agent-output', 'agent-transcript.txt'), 'RESULT: PARTIAL\n')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('moves a dirty tree on main to agent/<harness>/recovery-<run id>-<attempt>, bundles it, and pushes it', () => {
    writeFileSync(join(work, 'task.txt'), 'unfinished work\n')
    writeFileSync(join(work, 'new.ts'), 'export {}\n')

    const result = preserve()
    expect(result.status, result.stderr).toBe(0)

    const branch = 'agent/claude-code/recovery-4242-1'
    const head = git('rev-parse', 'HEAD')
    expect(git('branch', '--show-current')).toBe(branch)
    expect(git('status', '--porcelain')).toBe('')
    expect(git('log', '-1', '--format=%s')).toBe('wip: agent run 4242 UNFINISHED, UNVERIFIED')
    expect(git('rev-parse', 'HEAD^')).toBe(base)
    expect(git('show', 'HEAD:new.ts')).toBe('export {}')
    // The bundle is the evidence the artifact upload keeps if the push fails.
    const bundle = join(work, '.agent-output', 'recovery.bundle')
    git('bundle', 'verify', '-q', bundle) // throws if the bundle is unusable
    expect(git('bundle', 'list-heads', bundle)).toContain(head)
    expect(readFileSync(join(work, '.agent-output', 'recovery-head.txt'), 'utf8').trim()).toBe(head)
    // Pushed to the recovery branch; main untouched.
    expect(remoteHeads().sort()).toEqual([`refs/heads/${branch} ${head}`, `refs/heads/main ${base}`].sort())
  })

  it('a re-run attempt preserves its own work instead of failing to push over attempt 1', () => {
    // Re-running a job keeps GITHUB_RUN_ID, so a branch named by run id alone
    // was already on the remote, and attempt 2's push was rejected.
    writeFileSync(join(work, 'task.txt'), 'attempt 1\n')
    expect(preserve().status).toBe(0)
    const first = git('rev-parse', 'HEAD')
    git('switch', '-q', 'main')
    git('reset', '-q', '--hard', base)
    writeFileSync(join(work, 'task.txt'), 'attempt 2\n')

    const result = runWorkflowStep(workflowStep(AGENT_RUN, 'run', PRESERVE), {
      cwd: work, env: { ...env, GITHUB_RUN_ATTEMPT: '2' },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(remoteHeads().sort()).toEqual([
      `refs/heads/agent/claude-code/recovery-4242-1 ${first}`,
      `refs/heads/agent/claude-code/recovery-4242-2 ${git('rev-parse', 'HEAD')}`,
      `refs/heads/main ${base}`,
    ].sort())
  })

  it('does nothing with a clean, fully pushed tree', () => {
    const result = preserve()
    expect(result.status, result.stderr).toBe(0)

    expect(git('branch', '--show-current')).toBe('main')
    expect(git('rev-parse', 'HEAD')).toBe(base)
    expect(git('branch', '--list')).toBe('* main')
    expect(existsSync(join(work, '.agent-output', 'recovery.bundle'))).toBe(false)
    expect(existsSync(join(work, '.agent-output', 'recovery-head.txt'))).toBe(false)
    expect(remoteHeads()).toEqual([`refs/heads/main ${base}`])
  })
})

/**
 * GitHub created 10 of the ~100 scheduled agent runs from 10-29 to 10-31, so
 * the queue drained one task every four or five hours. A finished run starts
 * the next; an agent PR's CI finishing starts the ship.
 */
describe('the loop keeps itself going without the scheduler', () => {
  const CHAIN_STEP = 'Start the next run unless the chain is at its cap'
  const agentRun = () => yaml.load(read(AGENT_RUN))

  it('chains without actions: write, so no job here can dispatch a deploy', () => {
    const workflow = agentRun()
    expect(workflow.permissions.actions).toBe('read')
    expect(workflow.jobs.chain.permissions).toEqual({})
    expect(workflow.jobs.chain.needs).toBe('run')
    // The agent's own token: Contents write is all a repository_dispatch needs,
    // and production-deployment.yml does not listen for one.
    expect(workflow.jobs.chain.env.GH_TOKEN).toBe('${{ secrets.AGENT_GH_TOKEN }}')
    expect(Object.keys(yaml.load(read('.github/workflows/production-deployment.yml')).on)).toEqual(['workflow_dispatch'])
    // No checkout: nothing the agent wrote runs here.
    expect(JSON.stringify(workflow.jobs.chain)).not.toContain('actions/checkout')
    expect(workflow.on.repository_dispatch.types).toEqual(['agent-run-next'])
  })

  it('chains only after a run that finished a task', () => {
    const workflow = agentRun()
    expect(workflow.jobs.chain.if).toBe(
      "${{ !inputs.dry_run && (inputs.harness || 'claude-code') == 'claude-code' && needs.run.result == 'success' && needs.run.outputs.result == 'OK' }}")
    expect(workflow.jobs.run.outputs.result).toBe('${{ steps.verdict.outputs.result }}')
    expect(workflow.jobs.run.steps.find((s: { name?: string }) => s.name === VERDICT).id).toBe('verdict')
    expect(workflow.jobs.chain.env.DEPTH).toBe("${{ github.event.client_payload.chain_depth || '0' }}")
    // The schedule stays as the fallback that restarts an ended chain.
    expect(workflow.on.schedule).toEqual([{ cron: '5,35 * * * *' }])
  })

  describe('the chain step, executed', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'agent-run-chain-'))
      writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "$@" >> "$(dirname "$0")/gh-calls"\n', { mode: 0o755 })
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))
    const chain = (depth: string, max: string) => {
      const result = runWorkflowStep(workflowStep(AGENT_RUN, 'chain', CHAIN_STEP), {
        cwd: dir,
        env: { PATH: `${dir}:${process.env.PATH}`, GH_REPO: 'Graceful-Tools/astrid-web', DEPTH: depth, MAX_CHAIN: max },
      })
      const calls = existsSync(join(dir, 'gh-calls')) ? read(join(dir, 'gh-calls')).trim() : ''
      return { ...result, calls }
    }

    it('starts the next run one deeper', () => {
      const { status, calls } = chain('2', '8')
      expect(status).toBe(0)
      expect(calls).toBe('api repos/Graceful-Tools/astrid-web/dispatches -f event_type=agent-run-next -F client_payload[chain_depth]=3')
    })

    it('stops at the cap and leaves the rest to the schedule', () => {
      const { status, calls, stdout } = chain('8', '8')
      expect(status).toBe(0)
      expect(calls).toBe('')
      expect(stdout).toContain('the schedule takes over')
    })
  })

  it('ships when an agent PR finishes CI, from main, for green runs only', () => {
    const workflow = yaml.load(read('.github/workflows/agent-ship.yml'))
    expect(workflow.on.workflow_run.types).toEqual(['completed'])
    expect(workflow.jobs.ship.if).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(workflow.jobs.ship.if).toContain("startsWith(github.event.workflow_run.head_branch, 'agent/')")
    expect(workflow.jobs.ship.if).toContain("vars.ASTRID_SHIP_ENABLED == 'true'")
    // A dispatch defaults to a dry run; a workflow_run is a real one, like the schedule.
    expect(workflow.jobs.ship.env.DRY_RUN).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}")
  })

  it('listens for workflows that exist, so a rename cannot silently stop shipping', () => {
    const names = readdirSync('.github/workflows')
      .filter(file => /\.ya?ml$/.test(file))
      .map(file => yaml.load(read(join('.github/workflows', file)))?.name)
    for (const name of yaml.load(read('.github/workflows/agent-ship.yml')).on.workflow_run.workflows) {
      expect(names, name).toContain(name)
    }
  })
})
