/**
 * AWTD-1682: the cloud worker does astrid-core tasks, and the ship workflow lands them.
 *
 * astrid-core has no deploy, so a core task's handoff is `AWAITING-MERGE:
 * Graceful-Tools/astrid-core#<n> <sha>` rather than `AWAITING-DEPLOY: <sha>`, and the
 * runner completes it once that PR is merged at that head. Landing a core PR takes the
 * same proof a web cloud PR does: an agent branch, the assignee's own current marker
 * naming exactly this PR and head, Doing (or Testing), the board, green checks, and a
 * merge pinned to the inspected head.
 */
import { describe, expect, it } from 'vitest'
import { agentEmail } from '@/lib/brand/agent-emails'
import {
  CORE_REPO,
  awaitingMergeMarker,
  coreHandoffEligible,
  coreTasksMerged,
  landableCorePullRequests,
  latestHandoff,
  mergedCompletionComment,
  parseAwaitingMerge,
  type CorePullRequest,
} from '@/scripts/lib/core-handoff'
import { isAwaitingMerge, isAwaitingDeploy, RELEASE_MARKER } from '@/scripts/lib/doing-release'
import { summary } from '@/scripts/lib/land-and-deploy'

const head = 'c'.repeat(40)
const other = 'd'.repeat(40)
const task = {
  identifier: 'AWTD-1700', completed: false, statusRole: 'doing',
  assignee: { id: 'claude-id', email: agentEmail('claude') }, lists: [{ id: 'web' }],
}
const marker = { authorId: 'claude-id', createdAt: '2026-11-15T10:00:00Z',
  content: `Opened ${CORE_REPO}#41.\n\nAWAITING-MERGE: ${CORE_REPO}#41 ${head}` }
const pr = (over: Partial<CorePullRequest> = {}): CorePullRequest => ({
  number: 41,
  headRefName: 'agent/claude-code/AWTD-1700-recurrence-rule',
  headRefOid: head,
  baseRefName: 'main',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  checks: [{ name: 'core (linux)', bucket: 'pass' }, { name: 'astrid-rules (wasm32)', bucket: 'pass' }],
  ...over,
})
const eligible = (over: Partial<Parameters<typeof coreHandoffEligible>[0]> = {}) =>
  coreHandoffEligible({ repo: CORE_REPO, pr: pr(), listId: 'web', task, comments: [marker], ...over })

describe('AWTD-1682: the AWAITING-MERGE marker', () => {
  it('AWTD-1682: parses repo, PR number and sha, and writes the same line back', () => {
    expect(parseAwaitingMerge(marker.content)).toEqual({ repo: CORE_REPO, number: 41, sha: head })
    expect(awaitingMergeMarker({ repo: CORE_REPO, number: 41, sha: head })).toBe(`AWAITING-MERGE: ${CORE_REPO}#41 ${head}`)
    expect(parseAwaitingMerge(`  awaiting-merge: ${CORE_REPO}#7 ${head.toUpperCase()}`)).toEqual({ repo: CORE_REPO, number: 7, sha: head })
  })

  it('AWTD-1682: is not a marker without a PR number or a sha, or mid-line', () => {
    expect(parseAwaitingMerge(`AWAITING-MERGE: ${CORE_REPO} ${head}`)).toBeNull()
    expect(parseAwaitingMerge(`AWAITING-MERGE: ${CORE_REPO}#41`)).toBeNull()
    expect(parseAwaitingMerge(`I will write AWAITING-MERGE: ${CORE_REPO}#41 ${head} later`)).toBeNull()
  })

  it('AWTD-1682: the newest handoff of either kind is the current one', () => {
    const deploy = { authorId: 'claude-id', createdAt: '2026-11-15T11:00:00Z', content: `AWAITING-DEPLOY: ${other}` }
    expect(latestHandoff([marker])).toEqual({ kind: 'merge', repo: CORE_REPO, number: 41, sha: head })
    expect(latestHandoff([marker, deploy])).toEqual({ kind: 'deploy', sha: other })
    expect(latestHandoff([deploy, { ...marker, createdAt: '2026-11-15T12:00:00Z' }]))
      .toEqual({ kind: 'merge', repo: CORE_REPO, number: 41, sha: head })
    expect(latestHandoff([{ content: 'no marker here', createdAt: '2026-11-15T12:00:00Z' }])).toBeNull()
  })

  it('AWTD-1682: the Doing release skips a current AWAITING-MERGE handoff, as it skips AWAITING-DEPLOY', () => {
    expect(isAwaitingMerge([marker])).toBe(true)
    expect(isAwaitingDeploy([marker])).toBe(false)
    // A release after the marker starts a new attempt: the old handoff no longer counts.
    expect(isAwaitingMerge([marker, { content: `${RELEASE_MARKER}: run died`, createdAt: '2026-11-15T11:00:00Z' }])).toBe(false)
    expect(isAwaitingMerge([marker, { content: 'done', createdAt: '2026-11-15T11:00:00Z', systemEventType: 'COMPLETED' }])).toBe(false)
    expect(isAwaitingMerge([{ content: 'progress note', createdAt: '2026-11-15T11:00:00Z' }])).toBe(false)
  })
})

describe('AWTD-1682: which core PRs may be landed', () => {
  it('AWTD-1682: accepts the assignee\'s exact handoff on a Doing or Testing task on the board', () => {
    expect(eligible()).toBe(true)
    expect(eligible({ task: { ...task, statusRole: 'testing' } })).toBe(true)
    expect(eligible({ pr: pr({ headRefName: 'agent/claude/AWTD-1700-recurrence-rule' }) })).toBe(true)
  })

  it('AWTD-1682: pins the exact head — a marker for an older commit lands nothing', () => {
    expect(eligible({ pr: pr({ headRefOid: other }) })).toBe(false)
    expect(eligible({ pr: pr({ headRefOid: 'c'.repeat(12) }) })).toBe(false)
  })

  it('AWTD-1682: the marker must name this repo and this PR', () => {
    expect(eligible({ pr: pr({ number: 42 }) })).toBe(false)
    expect(eligible({ repo: 'Graceful-Tools/astrid-web' })).toBe(false)
  })

  it('AWTD-1682: refuses a spoofed marker, the wrong lane, board, assignee, branch or base', () => {
    expect(eligible({ comments: [{ ...marker, authorId: 'human' }] })).toBe(false)
    expect(eligible({ comments: [marker, { authorId: 'human', createdAt: '2026-11-15T11:00:00Z',
      content: `AWAITING-MERGE: ${CORE_REPO}#41 ${other}` }] })).toBe(false)
    for (const statusRole of ['ready', 'waiting', null]) expect(eligible({ task: { ...task, statusRole } })).toBe(false)
    expect(eligible({ task: { ...task, completed: true } })).toBe(false)
    expect(eligible({ listId: 'ios' })).toBe(false)
    expect(eligible({ task: { ...task, assignee: { id: 'human', email: 'human@example.test' } } })).toBe(false)
    expect(eligible({ task: { ...task, identifier: 'AWTD-1701' } })).toBe(false)
    expect(eligible({ pr: pr({ headRefName: 'feature/awtd-1700' }) })).toBe(false)
    expect(eligible({ pr: pr({ headRefName: 'agent/codex/AWTD-1700-x' }) })).toBe(false)
    expect(eligible({ pr: pr({ baseRefName: 'release' }) })).toBe(false)
  })

  it('AWTD-1682: a newer AWAITING-DEPLOY replaces the core handoff', () => {
    expect(eligible({ comments: [marker, { authorId: 'claude-id', createdAt: '2026-11-15T11:00:00Z',
      content: `AWAITING-DEPLOY: ${head}` }] })).toBe(false)
  })

  it('AWTD-1682: lands only a validated agent handoff, green and clean, never a human branch', () => {
    const decide = (prs: CorePullRequest[]) => landableCorePullRequests(prs)
    expect(decide([pr({ cloudHandoffValid: true })]).land.map(p => p.number)).toEqual([41])
    expect(decide([pr()]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: false })]).land).toHaveLength(0)
    // No runner marker is needed in a core PR body, so a non-agent branch must never qualify.
    expect(decide([pr({ headRefName: 'fix/awtd-1700-x', cloudHandoffValid: true })]).skipped[0].why)
      .toMatch(/not an agent handoff/)
    expect(decide([pr({ cloudHandoffValid: true, baseRefName: 'next' })]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: true, isDraft: true })]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: true, checks: [{ name: 'core (linux)', bucket: 'fail' }] })]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: true, checks: [{ name: 'core (linux)', bucket: 'pending' }] })]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: true, checks: [] })]).land).toHaveLength(0)
    expect(decide([pr({ cloudHandoffValid: true, mergeStateStatus: 'DIRTY' })]).land).toHaveLength(0)
  })
})

describe('AWTD-1682: completing a core task once its PR is merged', () => {
  const awaiting = [{ id: 't1', identifier: 'AWTD-1700', repo: CORE_REPO, number: 41, sha: head }]

  it('AWTD-1682: completes a task whose PR merged at its recorded head, with the merge sha', () => {
    const result = coreTasksMerged({
      awaiting,
      pullRequest: () => ({ state: 'MERGED', headRefOid: head, mergeCommit: { oid: 'e'.repeat(40) } }),
    })
    expect(result.done).toEqual([{ ...awaiting[0], mergeSha: 'e'.repeat(40) }])
    expect(result.waiting).toEqual([])
  })

  it('AWTD-1682: leaves an open, closed, re-pushed or unreadable PR\'s task in Doing', () => {
    for (const state of [
      { state: 'OPEN', headRefOid: head, mergeCommit: null },
      { state: 'CLOSED', headRefOid: head, mergeCommit: null },
      { state: 'MERGED', headRefOid: other, mergeCommit: { oid: 'e'.repeat(40) } },
      { state: 'MERGED', headRefOid: head, mergeCommit: null },
      null,
    ]) {
      const result = coreTasksMerged({ awaiting, pullRequest: () => state })
      expect(result.done, JSON.stringify(state)).toEqual([])
      expect(result.waiting).toHaveLength(1)
    }
  })

  it('AWTD-1682: the completion comment names the PR and merge sha and carries no marker', () => {
    const comment = mergedCompletionComment({ repo: CORE_REPO, number: 41, sha: head, mergeSha: 'e'.repeat(40) })
    expect(comment).toContain(`${CORE_REPO}#41`)
    expect(comment).toContain('e'.repeat(40))
    expect(comment).not.toMatch(/^\s*awaiting-(merge|deploy):/im)
    expect(parseAwaitingMerge(comment)).toBeNull()
  })

  it('AWTD-1682: the list news reports core landings and completions', () => {
    const news = summary({
      landed: [], skipped: [], verdict: { deploy: false, code: 0, reason: 'nothing new to deploy' },
      coreLanded: [`${CORE_REPO}#41`], coreCompleted: ['AWTD-1700'],
      coreSkipped: [{ ref: `${CORE_REPO}#40`, why: 'red: core (linux)' }],
    })
    expect(news).toContain(`Landed ${CORE_REPO}#41`)
    expect(news).toContain('AWTD-1700')
    expect(news).toContain(`${CORE_REPO}#40 — red: core (linux)`)
  })
})
