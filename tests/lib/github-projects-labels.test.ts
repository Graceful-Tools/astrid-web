/**
 * AWTD-1188 (P6c-2): GitHub labels → membership in label-flavor lists, one
 * list per (repo, label) (spec §8.4). Pure: what GitHub says, and the
 * memberships that converge on it.
 *
 * Pinned:
 *   - issues and pull requests carry labels; a draft and a redacted item do not;
 *   - a label is keyed by its NODE id, so one name in two repos is two labels;
 *   - by value: a label held and still on GitHub writes nothing;
 *   - a truncated list (totalCount above what was read) adds and never removes;
 *   - an item hydrated without the field says nothing about its labels;
 *   - a label renamed or recoloured on GitHub renames or recolours its list.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteProjectItem } from '@/lib/github/projects/apply'
import { labelListColor, labelListDrift, planLabels, remoteLabels } from '@/lib/github/projects/labels'

const page = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql/project-items-page.json'), 'utf8'))
const items = page.data.node.items.nodes as RemoteProjectItem[]
const issue = items.find(item => item.content?.__typename === 'Issue')!
const draft = items.find(item => item.content?.__typename === 'DraftIssue')!

type Label = { id: string; name: string; color: string }
const bug: Label = { id: 'LA_bug', name: 'bug', color: 'D73A4A' }
const docs: Label = { id: 'LA_docs', name: 'documentation', color: '0075ca' }

function labelled(item: RemoteProjectItem, labels: Label[], totalCount = labels.length): RemoteProjectItem {
  return { ...item, content: { ...item.content!, labels: { totalCount, nodes: labels } } }
}

describe('remoteLabels (AWTD-1188)', () => {
  it('reads an issue’s labels by node id, with the repo they belong to', () => {
    expect(remoteLabels(labelled(issue, [bug, docs]))).toEqual({
      repository: 'Graceful-Fools/wordlesolver',
      labels: [
        { nodeId: 'LA_bug', name: 'bug', color: 'D73A4A' },
        { nodeId: 'LA_docs', name: 'documentation', color: '0075ca' },
      ],
      complete: true,
    })
  })

  it('reads a pull request’s labels too', () => {
    const pullRequest = labelled({ ...issue, type: 'PULL_REQUEST', content: { ...issue.content!, __typename: 'PullRequest' } }, [bug])
    expect(remoteLabels(pullRequest)?.labels.map(label => label.nodeId)).toEqual(['LA_bug'])
  })

  it('a draft has no labels, and neither has a redacted item', () => {
    expect(remoteLabels(draft)).toBeNull()
    expect(remoteLabels({ ...issue, type: 'REDACTED' })).toBeNull()
  })

  it('more labels than were read is incomplete', () => {
    expect(remoteLabels(labelled(issue, [bug], 25))?.complete).toBe(false)
  })

  it('an item hydrated without the field says nothing: no labels, and not complete', () => {
    const { labels: _labels, ...content } = labelled(issue, []).content!
    expect(remoteLabels({ ...issue, content })).toMatchObject({ labels: [], complete: false })
  })
})

describe('planLabels (AWTD-1188)', () => {
  const remote = (labels: Label[], totalCount?: number) => remoteLabels(labelled(issue, labels, totalCount))!

  it('joins a label added on GitHub and leaves one removed there', () => {
    expect(planLabels(remote([bug]), ['LA_docs'])).toEqual({ join: ['LA_bug'], leave: ['LA_docs'] })
  })

  it('a label already held writes nothing', () => {
    expect(planLabels(remote([bug, docs]), ['LA_docs', 'LA_bug'])).toEqual({ join: [], leave: [] })
  })

  it('the same name in another repo is another label', () => {
    const otherRepoBug = { ...bug, id: 'LA_bug_other_repo' }
    expect(planLabels(remote([otherRepoBug]), ['LA_bug'])).toEqual({ join: ['LA_bug_other_repo'], leave: ['LA_bug'] })
  })

  it('a truncated list adds and never removes', () => {
    expect(planLabels(remote([bug], 25), ['LA_docs'])).toEqual({ join: ['LA_bug'], leave: [] })
  })
})

describe('label list appearance (AWTD-1188)', () => {
  it('GitHub’s bare hex becomes a list colour', () => {
    expect(labelListColor('D73A4A')).toBe('#d73a4a')
  })

  it('a label renamed or recoloured on GitHub is a patch for its list; an unchanged one is not', () => {
    const label = { nodeId: 'LA_bug', name: 'defect', color: 'D73A4A' }
    expect(labelListDrift(label, { name: 'bug', color: '#d73a4a' })).toEqual({ name: 'defect' })
    expect(labelListDrift(label, { name: 'defect', color: '#000000' })).toEqual({ color: '#d73a4a' })
    expect(labelListDrift(label, { name: 'defect', color: '#d73a4a' })).toBeNull()
  })
})
