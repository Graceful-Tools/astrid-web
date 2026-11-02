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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { queueContractLine } from '@/lib/agent-skill/astrid-queue-skill'
import {
  CLAUDE_OAUTH_SECRET,
  actionsClaudeCodeWorkflow,
  mcpServerName,
  mcpTokenSecretName,
} from '@/lib/agent-skill/loop-recipes'
import { STARTER_AGENTS, starterAgentSetup, startHereMarkdown } from '@/lib/start-here/business-blueprint'

// js-yaml ships no types; the rule tests load it the same way.
const { load } = require('js-yaml') as { load(source: string): unknown }

const ORIGIN = 'https://example.test'
const workflow = actionsClaudeCodeWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'list-build' })
type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }
type Job = { needs?: string; if?: string; outputs?: Record<string, string>; steps: Step[]; permissions?: Record<string, string> }
const doc = load(workflow.content) as { on: Record<string, unknown>; jobs: Record<string, Job> }

const tmp = mkdtempSync(join(tmpdir(), 'astrid-gate-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Run the gate step's script with curl stubbed to return `queue`. */
function runGate(queue: unknown): { hasWork: string; curlArgs: string } {
  const gate = doc.jobs['queue-gate'].steps.find(s => s.id === 'queue')!
  // GitHub substitutes ${{ secrets.X }} before the shell runs.
  const script = gate.run!.replace(/\$\{\{ secrets\.[A-Z_]+ \}\}/g, 'astrid_mcp_test')
  const bin = join(tmp, 'bin')
  execFileSync('mkdir', ['-p', bin])
  writeFileSync(join(tmp, 'queue-fixture.json'), JSON.stringify(queue))
  writeFileSync(
    join(bin, 'curl'),
    `#!/bin/bash\necho "$@" > "${join(tmp, 'curl-args')}"\ncat "${join(tmp, 'queue-fixture.json')}"\n`,
  )
  chmodSync(join(bin, 'curl'), 0o755)
  const output = join(tmp, 'github-output')
  writeFileSync(output, '')
  execFileSync('bash', ['-e', '-c', script], {
    cwd: tmp,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
  })
  const hasWork = /has-work=(\w+)/.exec(readFileSync(output, 'utf8'))?.[1] ?? ''
  return { hasWork, curlArgs: readFileSync(join(tmp, 'curl-args'), 'utf8') }
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
    const { hasWork, curlArgs } = runGate({ empty: false, queue: [{ id: 't1' }] })
    expect(hasWork).toBe('true')
    // The same agent-bound token, as a bearer, against this list's queue.
    expect(curlArgs).toContain(`${ORIGIN}/api/v1/agent-queue?agent=claude&listId=list-build`)
    expect(curlArgs).toContain('Authorization: Bearer astrid_mcp_test')
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
    expect(action.with!.prompt).toMatch(/Never merge or deploy/)
  })

  it('connects Claude Code to this server\'s MCP with the agent-bound token, and allows its tools', () => {
    const connect = doc.jobs.claude.steps.find(s => s.name?.startsWith('Connect Claude Code'))!
    expect(connect.env!.TOKEN).toBe(`\${{ secrets.${mcpTokenSecretName()} }}`)
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

  it('appears in the /starthere guide for Claude only — the other harnesses have no verified plan-billed CI path yet', () => {
    for (const agent of STARTER_AGENTS) {
      const hosted = starterAgentSetup(agent, ORIGIN, 'x').hosted
      if (agent.key === 'claude') expect(hosted?.workflow.path).toBe(workflow.path)
      else expect(hosted).toBeNull()
    }
    const md = startHereMarkdown(ORIGIN)
    expect(md).toContain('No machine to leave on? Run Claude in GitHub Actions instead.')
    expect(md).toContain(`\`${CLAUDE_OAUTH_SECRET}\``)
    expect(md).toContain('claude setup-token')
  })
})
