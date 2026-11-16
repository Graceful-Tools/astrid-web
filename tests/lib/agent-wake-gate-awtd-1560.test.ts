/**
 * AWTD-1560 — a generated loop wakes on Ready work, or on a reply it has not
 * already been woken for; never on `incomplete` alone.
 *
 * Jon's call (2026-11-13, option 1). The queue's `runnable` verdict reports
 * `incomplete: true` on every poll for a token without the chat scopes, and an
 * unanswered "thanks" stays in `attention` forever, so a gate that woke on
 * either would start a paid agent session every half hour. The gate keeps a
 * seen set between runs instead, the way the local runner's seen-file does.
 *
 * Since ADEV-8 the decision is `astrid-agent queue`'s, not shell's. Each test
 * RUNS the generated gate step with `npx` stubbed to the real CLI source (see
 * astrid-agent-gate-stub.ts), in a directory that persists between ticks, the
 * way actions/cache carries `.astrid-wake/`.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  actionsClaudeCodeWorkflow,
  actionsCopilotWorkflow,
  actionsQueueGateWorkflow,
} from '@/lib/agent-skill/loop-recipes'

import { installAgentStub } from './astrid-agent-gate-stub'

const { load } = require('js-yaml') as { load(source: string): unknown }

type Step = { id?: string; uses?: string; run?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> }
type Doc = { jobs: Record<string, { steps: Step[] }> }

// Every tick starts the real CLI under tsx, which is slow when the full suite shares the CPU.
vi.setConfig({ testTimeout: 60_000 })

const ORIGIN = 'https://example.test'
const roots: string[] = []
afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })))

const GATES = {
  'queue gate': actionsQueueGateWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'l1' }),
  'Claude Code workflow': actionsClaudeCodeWorkflow({ mailbox: 'claude', origin: ORIGIN, listId: 'l1' }),
  'Copilot workflow': actionsCopilotWorkflow({ mailbox: 'copilot', origin: ORIGIN, listId: 'l1' }),
}

/** A gate whose working directory survives between ticks. */
function gate(content: string) {
  const doc = load(content) as Doc
  const steps = doc.jobs['queue-gate'].steps
  const dir = mkdtempSync(join(tmpdir(), 'astrid-wake-'))
  roots.push(dir)
  const bin = installAgentStub(dir)
  const work = join(dir, 'work')
  mkdirSync(work)
  return {
    steps,
    tick(queue: unknown): string {
      writeFileSync(join(dir, 'fixture.json'), JSON.stringify(queue))
      const output = join(dir, 'out')
      writeFileSync(output, '')
      const step = steps.find(s => s.id === 'queue')!
      // GitHub substitutes ${{ secrets.X }} and puts the step's `env:` in the environment.
      const fill = (value: string) => value.replace(/\$\{\{[^}]+\}\}/g, 'x')
      const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, fill(v)]))
      execFileSync('bash', ['-e', '-c', fill(step.run!)], {
        cwd: work,
        env: { ...process.env, ...stepEnv, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
      })
      return /has-work=(\w+)/.exec(readFileSync(output, 'utf8'))?.[1] ?? ''
    },
  }
}

const quiet = { empty: true, queue: [], attention: { tasks: [], messages: [], truncated: false, skipped: [] } }
const runnable = (reasons: string[], incomplete = false) => ({ version: 1, hasWork: reasons.length > 0, reasons, incomplete })
const reply = (commentId: string) => ({ id: 't1', lastComment: { id: commentId } })

describe.each(Object.entries(GATES))('the %s wakes per Jon\'s option 1 (AWTD-1560)', (_name, workflow) => {
  it('wakes on Ready work, every tick it is there', () => {
    const g = gate(workflow.content)
    const ready = { ...quiet, empty: false, queue: [{ id: 'q1' }], runnable: runnable(['ready']) }
    expect(g.tick(ready)).toBe('true')
    expect(g.tick(ready)).toBe('true')
  })

  it('wakes once for an unanswered reply, then not again for the same one', () => {
    const g = gate(workflow.content)
    const waiting = { ...quiet, attention: { ...quiet.attention, tasks: [reply('c1')] }, runnable: runnable(['attention']) }
    expect(g.tick(waiting)).toBe('true')
    expect(g.tick(waiting)).toBe('false')
  })

  it('wakes again for a NEW reply, and for a list-chat message', () => {
    const g = gate(workflow.content)
    expect(g.tick({ ...quiet, attention: { ...quiet.attention, tasks: [reply('c1')] }, runnable: runnable(['attention']) })).toBe('true')
    expect(g.tick({ ...quiet, attention: { ...quiet.attention, tasks: [reply('c2')] }, runnable: runnable(['attention']) })).toBe('true')
    expect(g.tick({ ...quiet, attention: { ...quiet.attention, messages: [{ id: 'm1' }] }, runnable: runnable(['attention']) })).toBe('true')
  })

  it('never wakes on incomplete alone', () => {
    const g = gate(workflow.content)
    const partial = { ...quiet, attention: { ...quiet.attention, truncated: true, skipped: ['list chat: no chat:read'] }, runnable: runnable([], true) }
    expect(g.tick(partial)).toBe('false')
  })

  it('wakes on Ready work from a server that predates runnable', () => {
    const g = gate(workflow.content)
    expect(g.tick({ empty: false, queue: [{ id: 'q1' }] })).toBe('true')
  })

  it('fails the job, never idles, when the queue cannot be read (ADEV-8)', () => {
    const g = gate(workflow.content)
    expect(() => g.tick({ status: 500, error: 'boom' })).toThrow()
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
