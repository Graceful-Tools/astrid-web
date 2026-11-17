/**
 * AWTD-1494 — run Claude Code unattended in GitHub Actions, on the user's own
 * plan, with no machine left on.
 *
 * The workflow is generated (lib/agent-skill/loop-recipes.ts), so these tests
 * parse it as YAML and RUN its gate step: a stubbed `curl` answers with a real
 * queue payload, and the step's own shell decides whether the Claude job
 * starts. That is the gate → agent handoff, end to end, without GitHub.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { queueContractLine, ORCHESTRATION_GUIDANCE } from '@/lib/agent-skill/astrid-queue-skill'
import {
  CLAUDE_OAUTH_SECRET,
  actionsClaudeCodeWorkflow,
  mcpServerName,
  mcpTokenSecretName,
} from '@/lib/agent-skill/loop-recipes'
import { STARTER_AGENTS, starterAgentSetup, startHereMarkdown } from '@/lib/start-here/business-blueprint'

import { installAgentStub } from './astrid-agent-gate-stub'

// js-yaml ships no types; the rule tests load it the same way.
const { load } = require('js-yaml') as { load(source: string): unknown }

// The gate step starts the real CLI under tsx, which is slow when the full suite shares the CPU.
vi.setConfig({ testTimeout: 60_000 })

const ORIGIN = 'https://example.test'
const workflow = actionsClaudeCodeWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'list-build' })
type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }
type Job = { needs?: string; if?: string; outputs?: Record<string, string>; steps: Step[]; permissions?: Record<string, string> }
const doc = load(workflow.content) as { on: Record<string, unknown>; jobs: Record<string, Job> }

const tmp = mkdtempSync(join(tmpdir(), 'astrid-gate-'))
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

describe('Claude Code in GitHub Actions (AWTD-1494)', () => {
  it('runs on a 30-minute schedule and on demand', () => {
    expect(doc.on).toHaveProperty('workflow_dispatch')
    expect(doc.on.schedule).toEqual([{ cron: '*/30 * * * *' }])
  })

  it('gate: an empty queue starts nothing — a quiet half hour costs no Claude usage', () => {
    expect(runGate({ empty: true, queue: [] }).hasWork).toBe('false')
  })

  it('gate: queued work starts the Claude job', () => {
    const { hasWork, args, env } = runGate({ empty: false, queue: [{ id: 't1' }] })
    expect(hasWork).toBe('true')
    // One astrid-agent call, on the SDK's major 1, against this list's queue.
    expect(args).toContain('@gracefultools/astrid-sdk@1 astrid-agent queue --agent claude --list list-build')
    // The same agent-bound token the worker uses, as ASTRID_TOKEN.
    expect(env).toContain('ASTRID_TOKEN=astrid_mcp_test')
    expect(env).toContain(`ASTRID_API_URL=${ORIGIN}`)
    expect(doc.jobs['queue-gate'].steps.find(s => s.id === 'queue')!.run).not.toMatch(/curl|jq/)
  })

  it('the Claude job only runs when the gate says so', () => {
    const job = doc.jobs.claude
    expect(job.needs).toBe('queue-gate')
    expect(job.if).toBe("needs.queue-gate.outputs.has-work == 'true'")
    expect(doc.jobs['queue-gate'].outputs?.['has-work']).toBe('${{ steps.queue.outputs.has-work }}')
  })

  it('uses the official action with the plan-billed OAuth token and only verified inputs', () => {
    const action = doc.jobs.claude.steps.find(s => s.uses?.startsWith('anthropics/claude-code-action@'))!
    expect(action.uses).toBe('anthropics/claude-code-action@v1')
    expect(Object.keys(action.with!).sort()).toEqual(['claude_args', 'claude_code_oauth_token', 'prompt'])
    expect(action.with!.claude_code_oauth_token).toBe(`\${{ secrets.${CLAUDE_OAUTH_SECRET} }}`)
    expect(action.with!.prompt).toContain(queueContractLine({ mailbox: 'claude', listId: 'list-build' }))
    // AWTD-1693: the stored orchestration policy decides merge and deploy, not the prompt; its default is still never.
    expect(action.with!.prompt).toContain(ORCHESTRATION_GUIDANCE)
    expect(action.with!.prompt).not.toMatch(/Never merge or deploy/)
  })

  it('connects Claude Code to this server\'s MCP with the agent-bound token, and allows its tools', () => {
    const connect = doc.jobs.claude.steps.find(s => s.name?.startsWith('Connect Claude Code'))!
    expect(connect.env!.TOKEN).toBe(`\${{ secrets.${mcpTokenSecretName('claude')} }}`)
    expect(connect.run).toContain(`--arg url "${ORIGIN}/mcp"`)
    // Run the step's jq with a fake token: the config must be valid JSON.
    const config = execFileSync('bash', ['-e', '-c', connect.run!.replace(/> "\$RUNNER_TEMP\/[^"]+"/, '')], {
      env: { ...process.env, TOKEN: 'astrid_mcp_test', RUNNER_TEMP: tmp },
    }).toString()
    expect(JSON.parse(config)).toEqual({
      mcpServers: { [mcpServerName()]: { type: 'http', url: `${ORIGIN}/mcp`, headers: { Authorization: 'Bearer astrid_mcp_test' } } },
    })
    const args = doc.jobs.claude.steps.find(s => s.uses?.startsWith('anthropics/'))!.with!.claude_args
    expect(args).toContain(`--mcp-config \${{ runner.temp }}/${mcpServerName()}-mcp.json`)
    expect(args).toContain(`mcp__${mcpServerName()}`)
  })

  it('can push a branch and open a PR, and nothing more', () => {
    expect(doc.jobs.claude.permissions).toEqual({ contents: 'write', 'pull-requests': 'write', 'id-token': 'write' })
  })

  it('appears in the /starthere guide for Claude (Copilot has its own since AWTD-1502)', () => {
    for (const agent of STARTER_AGENTS) {
      const hosted = starterAgentSetup(agent, ORIGIN, 'x').hosted
      if (agent.key === 'claude') expect(hosted?.workflow.path).toBe(workflow.path)
      else if (agent.key !== 'copilot') expect(hosted).toBeNull()
    }
    const md = startHereMarkdown(ORIGIN)
    expect(md).toContain('No machine to leave on? Run Claude in GitHub Actions instead.')
    expect(md).toContain(`\`${CLAUDE_OAUTH_SECRET}\``)
    expect(md).toContain('claude setup-token')
  })
})
