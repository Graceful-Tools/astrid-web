// @vitest-environment node
/**
 * lib/core-rules/waiting-core.ts — the hook's own behaviour: the core's answer in decide mode, the
 * TypeScript's in shadow mode or when the core fails, agree/disagree counted on sampled decisions
 * only (AWTD-1591), and a disagreement logged by shape, never by id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWaitingCore } from '@/lib/core-rules/waiting-core'
import { setWaitingCore, waitingWrite, type WaitingWriteAnswer } from '@/lib/waiting-rules'

const NOW = new Date('2026-11-12T12:00:00.000Z')
const task = { id: 'secret-task-id', statusRole: 'ready', assigneeId: 'secret-person' }
const change = { statusRole: 'waiting', dueDateTime: '2026-11-20T00:00:00.000Z' }
const enter = JSON.stringify({ ok: true, value: { statusRole: 'waiting', assignee: 'clear', transition: 'enter' } })

function install(runJson: (request: string) => string, options: Parameters<typeof createWaitingCore>[2] = {}) {
  const report = { disagreement: vi.fn(), failure: vi.fn() }
  const hook = createWaitingCore(runJson, report, { sampleEvery: 1, ...options })
  setWaitingCore({ write: hook.write, settle: hook.settle, presets: hook.presets })
  return { hook, report }
}

afterEach(() => setWaitingCore(null))

describe('waiting core hook', () => {
  it('answers with the core and counts the sampled agreement', () => {
    const { hook } = install(() => enter)
    expect(waitingWrite(task, [], change, NOW)).toEqual({ ok: true, value: { statusRole: 'waiting', assignee: 'clear', transition: 'enter' } })
    expect(hook.stats).toMatchObject({ agreed: 1, disagreed: 0, failed: 0 })
  })

  it('reads the core refusal envelope as an answer, not a failure', () => {
    const { hook } = install(() =>
      JSON.stringify({ ok: false, error: { kind: 'refused', code: 'WAITING_NEEDS_CONDITION', message: 'Waiting needs a date or a task to wait on' } }),
    )
    const answer = waitingWrite(task, [], { statusRole: 'waiting' }, NOW) as Extract<WaitingWriteAnswer, { ok: false }>
    expect(answer.ok).toBe(false)
    expect(answer.code).toBe('WAITING_NEEDS_CONDITION')
    expect(hook.stats).toMatchObject({ agreed: 1, failed: 0 })
  })

  it('logs a disagreement by shape, returns the core in decide mode, and names no id or person', () => {
    const { hook, report } = install(() => JSON.stringify({ ok: true, value: { statusRole: 'waiting', assignee: 'keep', transition: 'enter' } }))
    const answer = waitingWrite(task, [], change, NOW)
    expect(answer.ok && answer.value.assignee).toBe('keep')
    expect(hook.stats.disagreed).toBe(1)
    const logged = JSON.stringify(report.disagreement.mock.calls)
    expect(logged).toContain('assignee')
    expect(logged).not.toContain('secret-task-id')
    expect(logged).not.toContain('secret-person')
  })

  it('in shadow mode the TypeScript decides', () => {
    install(() => JSON.stringify({ ok: true, value: { statusRole: 'waiting', assignee: 'keep', transition: 'enter' } }), { mode: 'shadow' })
    const answer = waitingWrite(task, [], change, NOW)
    expect(answer.ok && answer.value.assignee).toBe('clear')
  })

  it('falls back to the TypeScript when the core throws, and stays off afterwards', () => {
    const runJson = vi.fn(() => {
      throw new Error('boom')
    })
    const { hook, report } = install(runJson)
    expect(waitingWrite(task, [], change, NOW).ok).toBe(true)
    expect(waitingWrite(task, [], change, NOW).ok).toBe(true)
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(hook.stats.failed).toBe(2)
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('compares only 1 decision in N', () => {
    const { hook } = install(() => enter, { sampleEvery: 3 })
    for (let i = 0; i < 6; i++) waitingWrite(task, [], change, NOW)
    expect(hook.stats).toMatchObject({ agreed: 2, unsampled: 4 })
  })
})
