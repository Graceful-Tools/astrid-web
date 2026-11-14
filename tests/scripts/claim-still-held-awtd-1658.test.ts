/**
 * AWTD-1658 — a run re-validates its claim before it merges.
 *
 * The atomic claim prevents two starts, not two finishes: on 2026-11-13 an interactive run and
 * a scheduled run both finished one astrid-windows task. The re-check before merging is the
 * board read that catches it; these pin what counts as still holding the claim.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claimVerdict } from '@/scripts/lib/claim-still-held'

const me = 'claude@example.test'

describe('a claim is still held only while the task is ours and in progress (AWTD-1658)', () => {
  it('holds in Doing, assigned to this agent', () => {
    expect(claimVerdict({ statusRole: 'doing', assignee: { email: me } }, me)).toEqual({ held: true })
  })

  it('holds in Testing, where finished work may wait for its release', () => {
    expect(claimVerdict({ statusRole: 'testing', assignee: { email: 'Claude@Example.test' } }, me).held).toBe(true)
  })

  it('is lost when a peer finished the task', () => {
    const v = claimVerdict({ completed: true, statusRole: null, assignee: { email: me } }, me)
    expect(v).toEqual({ held: false, reason: 'the task is already complete' })
  })

  it('is lost when the task went back to Ready or the Inbox', () => {
    expect(claimVerdict({ statusRole: 'ready', assignee: { email: me } }, me).held).toBe(false)
    expect(claimVerdict({ statusRole: null, assignee: { email: me } }, me).held).toBe(false)
  })

  it('is lost when someone else holds it, and names them', () => {
    const v = claimVerdict({ statusRole: 'doing', assignee: { email: 'copilot@example.test' } }, me)
    expect(v.held).toBe(false)
    if (!v.held) expect(v.reason).toContain('copilot@example.test')
  })
})

describe('the shared workflow tells every run to re-check before merging (AWTD-1658)', () => {
  it('FIXALL_WORKFLOW names the check and what to do when it fires', () => {
    const doc = readFileSync(join(process.cwd(), 'docs', 'FIXALL_WORKFLOW.md'), 'utf8')
    expect(doc).toContain('scripts/check-claim.ts')
    expect(doc).toMatch(/do not merge/i)
  })
})
