/**
 * AWTD-1560 / ADEV-8 — a generated loop's gate is one `astrid-agent queue` call.
 *
 * The wake rule (Ready work, or a reply not yet woken for, never `incomplete`
 * alone) lives in the SDK's verdict.ts and is tested there. These tests RUN the
 * generated gate step with `npx` stubbed, and pin what the workflow owns: the
 * exit-code mapping (0 work, 3 idle, anything else fails the job), the seen file
 * carried by actions/cache, and the credentials the call is given.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  actionsClaudeCodeWorkflow,
  actionsCopilotWorkflow,
  actionsQueueGateWorkflow,
} from '@/lib/agent-skill/loop-recipes'

const { load } = require('js-yaml') as { load(source: string): unknown }

type Step = { id?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, string> }
type Doc = { jobs: Record<string, { steps: Step[] }> }

const ORIGIN = 'https://example.test'
const roots: string[] = []
afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })))

const GATES = {
  'queue gate': actionsQueueGateWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'l1' }),
  'Claude Code workflow': actionsClaudeCodeWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'l1' }),
  'Copilot workflow': actionsCopilotWorkflow({ mailbox: 'copilot', origin: ORIGIN, listId: 'l1' }),
}

/** Run the gate step with an `npx` that records its arguments and exits `code`. */
function gate(content: string) {
  const steps = (load(content) as Doc).jobs['queue-gate'].steps
  const dir = mkdtempSync(join(tmpdir(), 'astrid-wake-'))
  roots.push(dir)
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'npx'), `#!/bin/bash\necho "$@" > "${join(dir, 'npx-args')}"\necho '{"version":1}'\nexit "$(cat "${join(dir, 'code')}")"\n`)
  chmodSync(join(bin, 'npx'), 0o755)
  const work = join(dir, 'work')
  mkdirSync(work)
  return {
    steps,
    tick(code: number): { status: number | null; hasWork: string; args: string } {
      writeFileSync(join(dir, 'code'), String(code))
      const output = join(dir, 'out')
      writeFileSync(output, '')
      const script = steps.find(s => s.id === 'queue')!.run!
      const result = spawnSync('bash', ['-e', '-c', script], {
        cwd: work,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
      })
      return {
        status: result.status,
        hasWork: /has-work=(\w+)/.exec(readFileSync(output, 'utf8'))?.[1] ?? '',
        args: execFileSync('cat', [join(dir, 'npx-args')]).toString(),
      }
    },
  }
}

describe.each(Object.entries(GATES))('the %s is one astrid-agent queue call (ADEV-8)', (_name, workflow) => {
  it('wakes the agent job on exit 0', () => {
    const r = gate(workflow.content).tick(0)
    expect(r.status).toBe(0)
    expect(r.hasWork).toBe('true')
  })

  it('stays idle on exit 3', () => {
    const r = gate(workflow.content).tick(3)
    expect(r.status).toBe(0)
    expect(r.hasWork).toBe('false')
  })

  it('fails the job on exit 1 — never reads "could not tell" as idle', () => {
    const r = gate(workflow.content).tick(1)
    expect(r.status).not.toBe(0)
    expect(r.hasWork).toBe('')
  })

  it('runs the 1.x SDK against this origin, list and seen file', () => {
    const { args } = gate(workflow.content).tick(0)
    expect(args).toContain('@gracefultools/astrid-sdk@1')
    expect(args).toContain('astrid-agent queue --agent')
    expect(args).toContain('--list l1')
    expect(args).toContain(`--origin ${ORIGIN}`)
    expect(args).toContain('--seen .astrid-wake/seen.json --write-seen')
  })

  it('has no inline curl or jq in the gate', () => {
    const run = gate(workflow.content).steps.find(s => s.id === 'queue')!.run!
    expect(run).not.toMatch(/\b(curl|jq)\b/)
  })

  it('carries the seen set between runs with actions/cache, restored before and saved after the read', () => {
    const g = gate(workflow.content)
    const uses = g.steps.map(s => s.uses ?? s.id ?? '')
    const restore = uses.findIndex(u => u.startsWith('actions/cache/restore@'))
    const read = uses.indexOf('queue')
    const save = uses.findIndex(u => u.startsWith('actions/cache/save@'))
    expect(restore).toBeGreaterThanOrEqual(0)
    expect(restore).toBeLessThan(read)
    expect(save).toBeGreaterThan(read)
    expect(g.steps[save].if).toBe('always()')
  })
})
