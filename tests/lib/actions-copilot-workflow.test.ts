/**
 * AWTD-1502 — run Copilot CLI unattended in GitHub Actions, on the user's own
 * Copilot plan, the same shape as the Claude workflow (AWTD-1494).
 *
 * Every flag here was checked against Copilot CLI 1.0.99's own `--help` on
 * 2026-11-02: `-p` runs non-interactively, `--additional-mcp-config @file`
 * adds an HTTP server whose JSON shape matches what `copilot mcp add
 * --transport http --header` writes to ~/.copilot/mcp-config.json,
 * `--allow-all-tools` and `--no-ask-user` make it unattended, and
 * `COPILOT_GITHUB_TOKEN` outranks GH_TOKEN, so `gh` can keep the job token.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { queueContractLine, ORCHESTRATION_GUIDANCE } from '@/lib/agent-skill/astrid-queue-skill'
import {
  COPILOT_TOKEN_SECRET,
  actionsCopilotWorkflow,
  mcpServerName,
  mcpTokenSecretName,
} from '@/lib/agent-skill/loop-recipes'
import { STARTER_AGENTS, starterAgentSetup, startHereMarkdown } from '@/lib/start-here/business-blueprint'

import { installAgentStub } from './astrid-agent-gate-stub'

const { load } = require('js-yaml') as { load(source: string): unknown }

// The gate step starts the real CLI under tsx, which is slow when the full suite shares the CPU.
vi.setConfig({ testTimeout: 60_000 })

const ORIGIN = 'https://example.test'
const workflow = actionsCopilotWorkflow({ mailbox: 'copilot', origin: ORIGIN, listId: 'list-review' })
type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }
type Job = { needs?: string; if?: string; outputs?: Record<string, string>; steps: Step[]; permissions?: Record<string, string> }
const doc = load(workflow.content) as { on: Record<string, unknown>; jobs: Record<string, Job> }

const tmp = mkdtempSync(join(tmpdir(), 'astrid-copilot-gate-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Run the gate step with `npx astrid-agent` answering from `queue` (ADEV-8). */
function runGate(queue: unknown): { hasWork: string; args: string; env: string } {
  const gate = doc.jobs['queue-gate'].steps.find(s => s.id === 'queue')!
  // GitHub substitutes ${{ secrets.X }} and puts the step's `env:` in the environment.
  const fill = (value: string) => value.replace(/\$\{\{ secrets\.[A-Z_]+ \}\}/g, 'astrid_mcp_test')
  const stepEnv = Object.fromEntries(Object.entries(gate.env ?? {}).map(([k, v]) => [k, fill(v)]))
  const bin = installAgentStub(tmp)
  writeFileSync(join(tmp, 'fixture.json'), JSON.stringify(queue))
  const output = join(tmp, 'github-output')
  writeFileSync(output, '')
  execFileSync('bash', ['-e', '-c', fill(gate.run!)], {
    cwd: tmp,
    env: { ...process.env, ...stepEnv, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
  })
  const hasWork = /has-work=(\w+)/.exec(readFileSync(output, 'utf8'))?.[1] ?? ''
  return { hasWork, args: readFileSync(join(tmp, 'npx-args'), 'utf8'), env: readFileSync(join(tmp, 'npx-env'), 'utf8') }
}

const agentJob = () => doc.jobs.copilot
const runStep = () => agentJob().steps.find(s => s.name?.startsWith('Work the queue'))!

describe('Copilot CLI in GitHub Actions (AWTD-1502)', () => {
  it('runs on a 30-minute schedule and on demand (AWTD-1502)', () => {
    expect(workflow.path).toBe(`.github/workflows/${mcpServerName()}-copilot.yml`)
    expect(doc.on).toHaveProperty('workflow_dispatch')
    expect(doc.on.schedule).toEqual([{ cron: '*/30 * * * *' }])
  })

  it('gate: an empty queue starts nothing, queued work starts Copilot (AWTD-1502)', () => {
    expect(runGate({ empty: true, queue: [] }).hasWork).toBe('false')
    const { hasWork, args, env } = runGate({ empty: false, queue: [{ id: 't1' }] })
    expect(hasWork).toBe('true')
    // One astrid-agent call, on the SDK's major 1, against this list's queue.
    expect(args).toContain('@gracefultools/astrid-sdk@1 astrid-agent queue --agent copilot --list list-review')
    // The same agent-bound token the worker uses, as ASTRID_TOKEN.
    expect(env).toContain('ASTRID_TOKEN=astrid_mcp_test')
    expect(env).toContain(`ASTRID_API_URL=${ORIGIN}`)
    expect(doc.jobs['queue-gate'].steps.find(s => s.id === 'queue')!.run).not.toMatch(/curl|jq/)
    expect(agentJob().needs).toBe('queue-gate')
    expect(agentJob().if).toBe("needs.queue-gate.outputs.has-work == 'true'")
  })

  it('installs the official CLI from npm (AWTD-1502)', () => {
    const install = agentJob().steps.find(s => s.name === 'Install Copilot CLI')!
    expect(install.run).toBe('npm install -g @github/copilot')
  })

  it('writes an MCP config in the shape `copilot mcp add --header` writes (AWTD-1502)', () => {
    const connect = agentJob().steps.find(s => s.name?.startsWith('Connect Copilot CLI'))!
    expect(connect.env!.TOKEN).toBe(`\${{ secrets.${mcpTokenSecretName('copilot')} }}`)
    const config = execFileSync('bash', ['-e', '-c', connect.run!.replace(/> "\$RUNNER_TEMP\/[^"]+"/, '')], {
      env: { ...process.env, TOKEN: 'astrid_mcp_test', RUNNER_TEMP: tmp },
    }).toString()
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        [mcpServerName()]: {
          type: 'http',
          url: `${ORIGIN}/mcp`,
          headers: { Authorization: 'Bearer astrid_mcp_test' },
          tools: ['*'],
        },
      },
    })
  })

  it('runs Copilot non-interactively, on the plan token, with the queue contract (AWTD-1502)', () => {
    const step = runStep()
    expect(step.env![COPILOT_TOKEN_SECRET]).toBe(`\${{ secrets.${COPILOT_TOKEN_SECRET} }}`)
    // gh opens the pull request with the job's own token; Copilot ignores it
    // because COPILOT_GITHUB_TOKEN takes precedence.
    expect(step.env!.GH_TOKEN).toBe('${{ github.token }}')
    expect(step.run).toMatch(/^copilot -p "\$PROMPT"/)
    expect(step.env!.PROMPT).toContain(queueContractLine({ mailbox: 'copilot', listId: 'list-review' }))
    // AWTD-1693: the stored orchestration policy decides merge and deploy, not the prompt; its default is still never.
    expect(step.env!.PROMPT).toContain(ORCHESTRATION_GUIDANCE)
    expect(step.env!.PROMPT).not.toMatch(/Never merge or deploy/)
    expect(step.run).toContain(`--additional-mcp-config "@$RUNNER_TEMP/${mcpServerName()}-mcp.json"`)
    expect(step.run).toContain('--allow-all-tools')
    expect(step.run).toContain('--no-ask-user')
  })

  it('can push a branch and open a PR, and nothing more (AWTD-1502)', () => {
    expect(agentJob().permissions).toEqual({ contents: 'write', 'pull-requests': 'write' })
  })

  it('appears in the /starthere guide for Copilot, with how to make the plan token (AWTD-1502)', () => {
    const copilot = STARTER_AGENTS.find(a => a.key === 'copilot')!
    const hosted = starterAgentSetup(copilot, ORIGIN, 'x').hosted!
    expect(hosted.workflow.path).toBe(workflow.path)
    expect(hosted.secrets.map(s => s.name)).toEqual([COPILOT_TOKEN_SECRET, mcpTokenSecretName('copilot')])
    expect(hosted.secrets[0].how).toMatch(/fine-grained/)
    expect(hosted.secrets[0].how).toMatch(/Copilot Requests/)
    const md = startHereMarkdown(ORIGIN)
    expect(md).toContain('No machine to leave on? Run GitHub Copilot in GitHub Actions instead.')
  })

  it('gives each agent its own token secret, so Claude and Copilot can share a repository (AWTD-1502)', () => {
    expect(mcpTokenSecretName('copilot')).not.toBe(mcpTokenSecretName('claude'))
    expect(workflow.content).toContain(`secrets.${mcpTokenSecretName('copilot')}`)
    expect(workflow.content).not.toContain(`secrets.${mcpTokenSecretName('claude')}`)
  })

  it('lets a review task finish with findings instead of a new pull request (AWTD-1502)', () => {
    expect(runStep().env!.PROMPT).toMatch(/review task, post your findings on the existing pull request/)
  })

  it('says why Codex and Muse have no Actions workflow yet, instead of offering a broken one (AWTD-1502)', () => {
    for (const key of ['codex', 'muse']) {
      const agent = STARTER_AGENTS.find(a => a.key === key)!
      const setup = starterAgentSetup(agent, ORIGIN, 'x')
      expect(setup.hosted).toBeNull()
      expect(setup.hostedUnavailable).toMatch(/GitHub Actions/)
    }
    const md = startHereMarkdown(ORIGIN)
    expect(md).toMatch(/Codex[^\n]*API key/)
  })
})
