/**
 * AWTD-1191 (P6c-5): an AI agent assignment is mirrored on GitHub as a label
 * `agent:<name>` (spec §8.6, §15 C3). Pure: the label's name, and what the
 * issue's labels must change to match the agents assigned in Astrid.
 *
 * Pinned:
 *   - the name is the agent's mailbox, `agent:claude`;
 *   - GitHub's label names are case-insensitive, and so is the match;
 *   - a label already on the issue is not added again;
 *   - a label missing from the repo is created, one present is reused;
 *   - an `agent:` label for an agent no longer assigned is removed, and no
 *     other label is ever touched.
 */

import { describe, it, expect } from 'vitest'
import {
  agentLabelName,
  isAgentLabelName,
  parseAgentLabelLookup,
  planAgentLabelChange,
  planAgentLabelCreate,
  planAgentLabelLookup,
  planAgentLabelWrite,
} from '@/lib/github/projects/agent-labels'

const ISSUE = 'I_kwDOVCns8c8AAAABWTcnYA'

const lookup = (onIssue: Array<{ id: string; name: string }>, inRepo: Record<string, string | null>) => ({
  node: {
    labels: { nodes: onIssue },
    repository: { id: 'R_1', ...Object.fromEntries(Object.values(inRepo).map((id, i) => [`l${i}`, id ? { id } : null])) },
  },
})

describe('agent label names (AWTD-1191)', () => {
  it('names the label after the agent’s mailbox', () => {
    expect(agentLabelName({ email: 'claude@agents.example', name: 'Claude Agent' })).toBe('agent:claude')
    expect(agentLabelName({ email: 'Code.Bot+1@partner.example', name: null })).toBe('agent:code.bot-1')
  })

  it('falls back to the agent’s name, and to nothing when it has neither', () => {
    expect(agentLabelName({ email: null, name: 'Review Bot' })).toBe('agent:review-bot')
    expect(agentLabelName({ email: null, name: ' ' })).toBeNull()
  })

  it('recognises an agent label whatever its case', () => {
    expect(isAgentLabelName('agent:claude')).toBe(true)
    expect(isAgentLabelName('Agent:Claude')).toBe(true)
    expect(isAgentLabelName('agents')).toBe(false)
    expect(isAgentLabelName('bug')).toBe(false)
  })
})

describe('planning the label change (AWTD-1191)', () => {
  it('asks for the issue’s labels and for each wanted label in its repo', () => {
    const plan = planAgentLabelLookup(ISSUE, ['agent:claude', 'agent:codex'])
    expect(plan.variables).toEqual({ id: ISSUE, n0: 'agent:claude', n1: 'agent:codex' })
    expect(plan.document).toMatch(/l0: label\(name: \$n0\)/)
    expect(plan.document).toMatch(/\.\.\. on PullRequest/)
  })

  it('a node that is gone, or carries no labels, plans nothing', () => {
    expect(parseAgentLabelLookup({ node: null }, ['agent:claude'])).toBeNull()
    expect(parseAgentLabelLookup({ node: {} }, ['agent:claude'])).toBeNull()
  })

  it('creates a label the repo lacks and adds one it has', () => {
    const wanted = ['agent:claude', 'agent:codex']
    const state = parseAgentLabelLookup(lookup([], { 'agent:claude': null, 'agent:codex': 'LA_codex' }), wanted)!
    expect(planAgentLabelChange(state, wanted)).toEqual({ create: ['agent:claude'], add: ['LA_codex'], remove: [] })
  })

  it('a label already on the issue is left alone', () => {
    const state = parseAgentLabelLookup(
      lookup([{ id: 'LA_claude', name: 'Agent:Claude' }], { 'agent:claude': 'LA_claude' }),
      ['agent:claude'],
    )!
    expect(planAgentLabelChange(state, ['agent:claude'])).toEqual({ create: [], add: [], remove: [] })
  })

  it('removes the label of an agent no longer assigned, and no other label', () => {
    const onIssue = [
      { id: 'LA_claude', name: 'agent:claude' },
      { id: 'LA_bug', name: 'bug' },
    ]
    const state = parseAgentLabelLookup(lookup(onIssue, {}), [])!
    expect(planAgentLabelChange(state, [])).toEqual({ create: [], add: [], remove: ['LA_claude'] })
  })

  it('writes the creation and the change as aliased mutations', () => {
    const create = planAgentLabelCreate('R_1', ['agent:claude'], 'Assigned in Astrid')
    expect(create.document).toMatch(/c0: createLabel/)
    expect(create.variables).toMatchObject({ r: 'R_1', n0: 'agent:claude', d: 'Assigned in Astrid' })

    const write = planAgentLabelWrite(ISSUE, ['LA_claude'], ['LA_codex'])!
    expect(write.document).toMatch(/addLabelsToLabelable/)
    expect(write.document).toMatch(/removeLabelsFromLabelable/)
    expect(write.variables).toEqual({ id: ISSUE, add: ['LA_claude'], remove: ['LA_codex'] })

    expect(planAgentLabelWrite(ISSUE, ['LA_claude'], [])!.document).not.toMatch(/removeLabelsFromLabelable/)
    expect(planAgentLabelWrite(ISSUE, [], [])).toBeNull()
  })
})
