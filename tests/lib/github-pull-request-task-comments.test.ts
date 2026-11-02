/**
 * AWTD-1492 — pull requests and their reviews show up on the task that caused them.
 *
 * In the /starthere setup an agent opens a PR for its task and GitHub asks
 * Copilot to review it, and none of that reached Astrid: the owner had to open
 * GitHub to learn whether the PR was reviewed, approved or blocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn() },
  comment: { create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const ids = vi.hoisted(() => ({ resolveTaskIdOrIdentifier: vi.fn() }))
vi.mock('@/lib/task-identifier', () => ids)

const comments = vi.hoisted(() => ({ broadcastCommentCreated: vi.fn(), COMMENT_INCLUDE: {} }))
vi.mock('@/services/comment.service', () => comments)

import {
  MAX_TASK_REFS,
  pullRequestEventComment,
  taskReferencesInPullRequest,
} from '@/lib/github/webhooks/pull-requests'
import { handlePullRequestTaskWebhook } from '@/services/github-pull-requests.service'

const REPO = 'Graceful-Tools/astrid-web'
const pr = (over: Record<string, unknown> = {}) => ({
  number: 42,
  title: 'Fix the thing (AWTD-1492)',
  html_url: 'https://github.com/Graceful-Tools/astrid-web/pull/42',
  node_id: 'PR_kw42',
  head: { ref: 'agent/claude-code/AWTD-1492-pr-comments' },
  base: { ref: 'main' },
  body: '',
  user: { login: 'claude-bot' },
  updated_at: '2026-11-02T03:00:00Z',
  ...over,
})
const task = { id: 'task-1', title: 'T', creatorId: 'owner', assigneeId: null, lists: [{ id: 'l1', githubRepositoryId: REPO, listMembers: [] }] }

describe('taskReferencesInPullRequest (AWTD-1492)', () => {
  it('finds identifiers in the branch, title and body, deduplicated and canonical', () => {
    expect(taskReferencesInPullRequest({
      branch: 'agent/claude-code/awtd-1492-pr-comments',
      title: 'Fix (AWTD-1492)',
      body: 'Also touches AITD-7.',
    })).toEqual(['AWTD-1492', 'AITD-7'])
  })

  it('finds task links by uuid', () => {
    expect(taskReferencesInPullRequest({
      body: 'For https://tasks.example.com/tasks/D8B899C5-A8EF-49E7-9FD5-0480C9701F46',
    })).toEqual(['d8b899c5-a8ef-49e7-9fd5-0480c9701f46'])
  })

  it('caps the number of tasks one PR can comment on', () => {
    const body = Array.from({ length: 20 }, (_, i) => `AWTD-${i + 1}`).join(' ')
    expect(taskReferencesInPullRequest({ body })).toHaveLength(MAX_TASK_REFS)
  })
})

describe('pullRequestEventComment (AWTD-1492)', () => {
  it('says a PR was opened, merged, or closed without merging', () => {
    expect(pullRequestEventComment('pull_request', { action: 'opened', pull_request: pr() })?.content)
      .toBe('Opened pull request [#42 Fix the thing (AWTD-1492)](https://github.com/Graceful-Tools/astrid-web/pull/42).')
    expect(pullRequestEventComment('pull_request', {
      action: 'closed', pull_request: pr({ merged: true, merged_by: { login: 'jonparis' } }),
    })).toMatchObject({ login: 'jonparis', key: 'astrid:pr:PR_kw42:merged', content: expect.stringMatching(/^Merged .* into `main`\.$/) })
    expect(pullRequestEventComment('pull_request', {
      action: 'closed', pull_request: pr({ merged: false, closed_at: '2026-11-02T04:00:00Z' }),
    })?.content).toMatch(/without merging/)
  })

  it('ignores PR noise — a push, a label, an edit', () => {
    for (const action of ['synchronize', 'labeled', 'edited', 'assigned']) {
      expect(pullRequestEventComment('pull_request', { action, pull_request: pr() })).toBeNull()
    }
  })

  it('carries a review verdict and an excerpt of what the reviewer said', () => {
    const comment = pullRequestEventComment('pull_request_review', {
      action: 'submitted',
      pull_request: pr(),
      review: {
        node_id: 'PRR_1',
        state: 'changes_requested',
        body: 'The retry loop never backs off.\nPlease add a cap.',
        html_url: 'https://github.com/x/pull/42#pullrequestreview-1',
        user: { login: 'copilot-pull-request-reviewer[bot]' },
      },
    })
    expect(comment).toMatchObject({ key: 'PRR_1', login: 'copilot-pull-request-reviewer[bot]' })
    expect(comment!.content).toContain('Requested changes on pull request [#42')
    expect(comment!.content).toContain('> The retry loop never backs off.\n> Please add a cap.')
    expect(comment!.content).toContain('[Read the full review](https://github.com/x/pull/42#pullrequestreview-1)')
  })

  it('skips an empty "commented" review shell, keeps an empty approval', () => {
    const review = (state: string) => ({ node_id: 'PRR_2', state, body: '', user: { login: 'r' } })
    expect(pullRequestEventComment('pull_request_review', { action: 'submitted', pull_request: pr(), review: review('commented') })).toBeNull()
    expect(pullRequestEventComment('pull_request_review', { action: 'submitted', pull_request: pr(), review: review('approved') })?.content)
      .toMatch(/^Approved pull request/)
  })
})

describe('handlePullRequestTaskWebhook (AWTD-1492)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ids.resolveTaskIdOrIdentifier.mockImplementation(async (ref: string) => (ref === 'AWTD-1492' ? 'task-1' : null))
    db.task.findMany.mockResolvedValue([task])
    db.comment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }))
  })

  it('comments on the named task, attributed to the GitHub login, once per event', async () => {
    const written = await handlePullRequestTaskWebhook('pull_request', {
      action: 'opened', pull_request: pr(), repository: { full_name: REPO },
    })

    expect(written).toBe(1)
    expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: 'task-1',
        authorId: null,
        remoteAuthorLogin: 'claude-bot',
        remoteNodeId: 'astrid:pr:PR_kw42:opened:task-1',
        type: 'MARKDOWN',
      }),
    }))
    expect(comments.broadcastCommentCreated).toHaveBeenCalledTimes(1)
  })

  it('only reaches tasks on lists linked to the PR\'s own repository', async () => {
    await handlePullRequestTaskWebhook('pull_request', {
      action: 'opened', pull_request: pr(), repository: { full_name: 'stranger/fork' },
    })
    const where = db.task.findMany.mock.calls[0][0].where
    expect(where.lists.some.githubRepositoryId).toEqual({ equals: 'stranger/fork', mode: 'insensitive' })
  })

  it('treats a redelivered webhook as already done, not an error', async () => {
    db.comment.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    const written = await handlePullRequestTaskWebhook('pull_request', {
      action: 'opened', pull_request: pr(), repository: { full_name: REPO },
    })
    expect(written).toBe(0)
    expect(comments.broadcastCommentCreated).not.toHaveBeenCalled()
  })

  it('does nothing for a PR that names no task, without querying tasks', async () => {
    const written = await handlePullRequestTaskWebhook('pull_request', {
      action: 'opened',
      pull_request: pr({ title: 'Bump deps', head: { ref: 'dependabot/npm' }, body: '' }),
      repository: { full_name: REPO },
    })
    expect(written).toBe(0)
    expect(db.task.findMany).not.toHaveBeenCalled()
  })
})
