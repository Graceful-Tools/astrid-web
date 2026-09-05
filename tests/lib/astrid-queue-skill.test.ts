/**
 * Adapter parity for the canonical Astrid queue skill (AWTD-759).
 *
 * One canonical body, four thin adapters. Every adapter must carry the whole
 * canonical behavior — mailbox/board explicitness, the assignment + Ready
 * handshake, due-date holds, comment/completion expectations, empty:true
 * termination, fail-visibly errors — and the version stamp that lets an
 * installed copy be recognized as stale.
 */

import { describe, expect, it } from 'vitest'

import {
  QUEUE_SKILL_VERSION,
  canonicalQueueSkill,
  queueContractLine,
  queueSkillAdapter,
  queueSkillAdapters,
  queueSkillSlug,
} from '@/lib/agent-skill/astrid-queue-skill'

const OPTS = { mailbox: 'codex', listId: 'board-123' }

describe('canonical queue skill (AWTD-759)', () => {
  it('requires an explicit mailbox instead of guessing an identity', () => {
    expect(() => canonicalQueueSkill({ mailbox: '' })).toThrow(/mailbox is required/)
    expect(() => queueContractLine({ mailbox: '   ' })).toThrow(/mailbox is required/)
  })

  it('states every canonical behavior', () => {
    const skill = canonicalQueueSkill(OPTS)

    // Version stamp for staleness detection.
    expect(skill).toContain(`v${QUEUE_SKILL_VERSION}`)
    // Explicit mailbox and board selection.
    expect(skill).toContain('agent "codex"')
    expect(skill).toContain('listId "board-123"')
    expect(skill).toContain('never poll another identity')
    // Assignment + Ready handshake.
    expect(skill).toMatch(/assigned to "codex" in Ready status/)
    // Due-date hold behavior.
    expect(skill).toContain('held.scheduled')
    // Progress/comment and completion expectations.
    expect(skill).toContain('strategy comment')
    expect(skill).toContain('completion report')
    expect(skill).toContain('update_task completed:true')
    // Termination and re-check.
    expect(skill).toContain('empty:true')
    expect(skill).toContain('stop and say nothing is queued')
    expect(skill).toMatch(/Re-check the queue/)
    // Errors fail visibly rather than retrying indefinitely.
    expect(skill).toContain('never retry silently')
  })

  it('instructs an explicit board choice when no listId is pinned', () => {
    const skill = canonicalQueueSkill({ mailbox: 'claude' })
    expect(skill).toContain('pick ONE board with get_lists')
    expect(skill).not.toContain('listId "board-123"')
  })
})

describe('generated adapters (AWTD-759)', () => {
  it('embeds the canonical body verbatim in every adapter — parity by construction', () => {
    const canonical = canonicalQueueSkill(OPTS)
    const adapters = queueSkillAdapters(OPTS)

    expect(adapters.map(adapter => adapter.harness)).toEqual([
      'claude-code',
      'copilot',
      'codex',
      'generic',
    ])
    for (const adapter of adapters) {
      expect(adapter.content).toContain(canonical)
      expect(adapter.content).toContain(`v${QUEUE_SKILL_VERSION}`)
    }
  })

  it('targets each harness\'s native install location', () => {
    const slug = queueSkillSlug()
    expect(queueSkillAdapter('claude-code', OPTS).installPath).toBe(`.claude/commands/${slug}.md`)
    expect(queueSkillAdapter('copilot', OPTS).installPath).toBe(`.github/agents/${slug}.agent.md`)
    expect(queueSkillAdapter('codex', OPTS).installPath).toBe('AGENTS.md')
    expect(queueSkillAdapter('generic', OPTS).installPath).toBe('AGENTS.md')
  })

  it('gives the Copilot custom agent its required frontmatter', () => {
    const copilot = queueSkillAdapter('copilot', OPTS)
    expect(copilot.content).toMatch(/^---\nname: .+\ndescription: .+\n---\n/)
  })

  it('keeps the AGENTS.md adapters usable as fragments of an existing file', () => {
    for (const harness of ['codex', 'generic'] as const) {
      expect(queueSkillAdapter(harness, OPTS).content).toMatch(/^## /)
    }
  })
})
