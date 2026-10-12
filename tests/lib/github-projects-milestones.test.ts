/**
 * AWTD-1189 (P6c-3): a GitHub milestone → membership in a milestone-flavor
 * list, one list per milestone node (spec §8.4). Pure: what GitHub says, and
 * the memberships that converge on it.
 *
 * Pinned:
 *   - issues and pull requests carry a milestone; a draft and a redacted item cannot;
 *   - "no milestone" and "cannot say" are different answers;
 *   - a milestone is keyed by its NODE id, so one title in two repos is two milestones;
 *   - by value: the milestone already held writes nothing;
 *   - AT MOST ONE — moving between milestones LEAVES the old list, which is the
 *     one place this is not a label;
 *   - a milestone renamed or re-dated on GitHub renames or re-dates its list.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import {
  isEmptyMilestonePlan,
  milestoneListDescription,
  milestoneListDrift,
  planMilestone,
  remoteMilestone,
} from '@/lib/github/projects/milestones'

const page = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql/project-items-page.json'), 'utf8'))
const items = page.data.node.items.nodes as RemoteProjectItem[]
const issue = items.find(item => item.content?.__typename === 'Issue')!
const draft = items.find(item => item.content?.__typename === 'DraftIssue')!

type Milestone = { id: string; title: string; dueOn: string | null }
const v12: Milestone = { id: 'MI_v12', title: 'v1.2', dueOn: '2026-11-01T07:00:00Z' }
const v13: Milestone = { id: 'MI_v13', title: 'v1.3', dueOn: null }

function withMilestone(item: RemoteProjectItem, milestone: Milestone | null): RemoteProjectItem {
  return { ...item, content: { ...item.content!, milestone } }
}

describe('remoteMilestone (AWTD-1189)', () => {
  it('reads an issue’s milestone by node id, with the repo it belongs to', () => {
    expect(remoteMilestone(withMilestone(issue, v12))).toEqual({
      repository: 'Graceful-Fools/wordlesolver',
      milestone: { nodeId: 'MI_v12', title: 'v1.2', dueOn: '2026-11-01T07:00:00Z' },
    })
  })

  it('reports no milestone as a fact, not as silence', () => {
    // The caller acts on this: it means "leave whichever milestone list you are
    // on". Returning null here instead would make an unset milestone unsettable.
    expect(remoteMilestone(withMilestone(issue, null))).toEqual({
      repository: 'Graceful-Fools/wordlesolver',
      milestone: null,
    })
  })

  it('says nothing for a draft issue, which cannot carry one', () => {
    expect(remoteMilestone(draft)).toBeNull()
  })

  it('says nothing for a redacted item', () => {
    expect(remoteMilestone({ ...withMilestone(issue, v12), type: 'REDACTED' })).toBeNull()
  })

  it('carries a missing dueOn through as null rather than dropping the milestone', () => {
    expect(remoteMilestone(withMilestone(issue, v13))?.milestone).toEqual({
      nodeId: 'MI_v13',
      title: 'v1.3',
      dueOn: null,
    })
  })
})

describe('planMilestone (AWTD-1189)', () => {
  const state = (milestone: Milestone | null) => ({
    repository: 'Graceful-Fools/wordlesolver',
    milestone: milestone ? { nodeId: milestone.id, title: milestone.title, dueOn: milestone.dueOn } : null,
  })

  it('joins the milestone’s list when the task is on none', () => {
    expect(planMilestone(state(v12), [])).toEqual({ join: 'MI_v12', leave: [] })
  })

  it('writes nothing when the task already holds exactly that milestone', () => {
    const plan = planMilestone(state(v12), ['MI_v12'])
    expect(plan).toEqual({ join: null, leave: [] })
    expect(isEmptyMilestonePlan(plan)).toBe(true)
  })

  it('LEAVES the old milestone when the task moves to another', () => {
    // The one place a milestone is not a label. Without this, an issue moved
    // from v1.2 to v1.3 would show both and nothing would ever take v1.2 off.
    expect(planMilestone(state(v13), ['MI_v12'])).toEqual({ join: 'MI_v13', leave: ['MI_v12'] })
  })

  it('leaves every milestone list when GitHub says the task has none', () => {
    expect(planMilestone(state(null), ['MI_v12'])).toEqual({ join: null, leave: ['MI_v12'] })
  })

  it('corrects a task that somehow holds two milestones', () => {
    // GitHub cannot produce this; an earlier bug or a hand edit can.
    expect(planMilestone(state(v12), ['MI_v12', 'MI_v13'])).toEqual({ join: null, leave: ['MI_v13'] })
  })
})

describe('milestoneListDrift (AWTD-1189)', () => {
  it('renames the list when the milestone is renamed', () => {
    expect(
      milestoneListDrift({ nodeId: 'MI_v12', title: 'v1.2.1', dueOn: '2026-11-01T07:00:00Z' }, 'Graceful-Fools/wordlesolver', {
        name: 'v1.2',
        description: 'Graceful-Fools/wordlesolver · 2026-11-01',
      }),
    ).toEqual({ name: 'v1.2.1' })
  })

  it('re-dates the list when the milestone’s due date moves', () => {
    expect(
      milestoneListDrift({ nodeId: 'MI_v12', title: 'v1.2', dueOn: '2026-12-01T07:00:00Z' }, 'Graceful-Fools/wordlesolver', {
        name: 'v1.2',
        description: 'Graceful-Fools/wordlesolver · 2026-11-01',
      }),
    ).toEqual({ description: 'Graceful-Fools/wordlesolver · 2026-12-01' })
  })

  it('is null when the list already matches', () => {
    expect(
      milestoneListDrift({ nodeId: 'MI_v12', title: 'v1.2', dueOn: '2026-11-01T07:00:00Z' }, 'Graceful-Fools/wordlesolver', {
        name: 'v1.2',
        description: 'Graceful-Fools/wordlesolver · 2026-11-01',
      }),
    ).toBeNull()
  })

  it('clears the date from the description when the milestone loses its due date', () => {
    expect(
      milestoneListDrift({ nodeId: 'MI_v12', title: 'v1.2', dueOn: null }, 'Graceful-Fools/wordlesolver', {
        name: 'v1.2',
        description: 'Graceful-Fools/wordlesolver · 2026-11-01',
      }),
    ).toEqual({ description: 'Graceful-Fools/wordlesolver' })
  })
})

describe('milestoneListDescription (AWTD-1189)', () => {
  it('joins the repo and the due day', () => {
    expect(milestoneListDescription('o/r', '2026-11-01T07:00:00Z')).toBe('o/r · 2026-11-01')
  })

  it('keeps whichever half it has', () => {
    expect(milestoneListDescription('o/r', null)).toBe('o/r')
    expect(milestoneListDescription(null, '2026-11-01T07:00:00Z')).toBe('2026-11-01')
    expect(milestoneListDescription(null, null)).toBeNull()
  })
})
