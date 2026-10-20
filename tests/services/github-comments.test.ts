/**
 * AWTD-1283: a comment made on github.com reaches the mirrored Astrid task.
 *
 * Before this, comments went one way only — Astrid → GitHub — so a GitHub-backed
 * board was not a faithful replica. The `issue_comment` job re-reads the comment
 * (the webhook is a trigger, never data) and:
 *
 *   - creates it on the task, authored by the Astrid user with that githubNodeId;
 *   - with no such user, keeps the GitHub login to show instead;
 *   - updates it when it was edited on GitHub, deletes it when GitHub has none;
 *   - never mirrors the App's own comments back (an agent's, posted as the bot);
 *   - adopts a person's own push instead of duplicating it (echo suppression);
 *   - never queues the mirrored comment to be pushed back to GitHub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  comment: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  task: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const comments = vi.hoisted(() => ({
  COMMENT_INCLUDE: { author: true },
  broadcastCommentCreated: vi.fn(),
  updateCommentWithSideEffects: vi.fn(async () => ({})),
  deleteCommentWithSideEffects: vi.fn(async () => undefined),
  createCommentWithSideEffects: vi.fn(),
}))
vi.mock('@/services/comment.service', () => comments)

const push = vi.hoisted(() => ({ enqueueCommentPush: vi.fn() }))
vi.mock('@/services/github-sync-jobs.service', () => push)

import { syncRemoteComment } from '@/services/github-comments.service'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const NOW = new Date('2026-10-20T15:05:00.000Z')
const PERSON_COMMENT = 'IC_kwDOVCns8c8AAAABb1Xq2w'
const ISSUE = 'I_kwDOVCns8c8AAAABWTcnYA'

const replaying = (body: unknown) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body)))
  const client = createGraphqlClient({
    token: 't',
    bucket: 'installation:1',
    priority: 'hydrate',
    budget: createBudget(memoryBudgetStore()),
    fetch: fetch as never,
  })
  return { client, fetch }
}

const task = {
  id: 't1',
  title: 'Date picker closes',
  creatorId: 'u-creator',
  assigneeId: null,
  lists: [{ id: 'board-1', name: 'Board', ownerId: 'u-owner', listMembers: [] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.comment.findUnique.mockResolvedValue(null)
  db.comment.findMany.mockResolvedValue([])
  db.task.findUnique.mockResolvedValue(task)
  db.user.findUnique.mockResolvedValue(null)
  db.comment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', ...data, author: null }))
})

describe('syncRemoteComment (AWTD-1283)', () => {
  it('asks GitHub for the comment by its node id — the webhook body is never trusted', async () => {
    const { client, fetch } = replaying(load('issue-comment-person.json'))
    await syncRemoteComment(PERSON_COMMENT, client, NOW)
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(sent.query).toMatch(/IssueComment/)
    expect(sent.variables).toEqual({ id: PERSON_COMMENT })
  })

  it('creates a GitHub comment on the mirrored task, authored by the matching Astrid user', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-octo' })
    const { client } = replaying(load('issue-comment-person.json'))

    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('create')
    expect(db.task.findUnique.mock.calls[0][0].where).toEqual({ remoteNodeId: ISSUE })
    expect(db.user.findUnique.mock.calls[0][0].where).toEqual({ githubNodeId: 'U_kgDOCm9cTQ' })
    expect(db.comment.create.mock.calls[0][0].data).toMatchObject({
      taskId: 't1',
      authorId: 'u-octo',
      remoteNodeId: PERSON_COMMENT,
      remoteAuthorLogin: null,
      content: 'Reproduced on Safari 18 too — the date picker closes on scroll.',
      createdAt: new Date('2026-10-20T15:02:11Z'),
    })
    expect(comments.broadcastCommentCreated).toHaveBeenCalledTimes(1)
  })

  it('an author with no Astrid identity keeps their GitHub login for display', async () => {
    const { client } = replaying(load('issue-comment-person.json'))
    await syncRemoteComment(PERSON_COMMENT, client, NOW)
    expect(db.comment.create.mock.calls[0][0].data).toMatchObject({ authorId: null, remoteAuthorLogin: 'octo-tester' })
  })

  it('never pushes the mirrored comment back to GitHub', async () => {
    const { client } = replaying(load('issue-comment-person.json'))
    await syncRemoteComment(PERSON_COMMENT, client, NOW)
    expect(push.enqueueCommentPush).not.toHaveBeenCalled()
    expect(comments.createCommentWithSideEffects).not.toHaveBeenCalled()
  })

  it('a PR conversation comment lands on the PR task, not the issue-shaped twin', async () => {
    const { client } = replaying(load('issue-comment-pull-request.json'))
    await syncRemoteComment('IC_kwDOVCns8c8AAAABb1Yz9A', client, NOW)
    expect(db.task.findUnique.mock.calls[0][0].where).toEqual({ remoteNodeId: 'PR_kwDOVCns8c6Ah3Zq' })
  })

  it('a comment on an issue no board mirrors changes nothing', async () => {
    db.task.findUnique.mockResolvedValue(null)
    const { client } = replaying(load('issue-comment-person.json'))
    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('none')
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('an edit on GitHub updates the mirrored comment', async () => {
    db.comment.findUnique.mockResolvedValue({ id: 'cm-9', content: 'Reproduced on Safari', taskId: 't1' })
    const { client } = replaying(load('issue-comment-person.json'))

    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('update')
    expect(db.comment.findUnique.mock.calls[0][0].where).toEqual({ remoteNodeId: PERSON_COMMENT })
    expect(comments.updateCommentWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 'cm-9', content: 'Reproduced on Safari 18 too — the date picker closes on scroll.' }),
    )
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('a redelivery of an unchanged comment changes nothing', async () => {
    db.comment.findUnique.mockResolvedValue({
      id: 'cm-9',
      content: 'Reproduced on Safari 18 too — the date picker closes on scroll.',
      taskId: 't1',
    })
    const { client } = replaying(load('issue-comment-person.json'))
    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('none')
    expect(comments.updateCommentWithSideEffects).not.toHaveBeenCalled()
  })

  it('a comment deleted on GitHub is deleted from the task', async () => {
    db.comment.findUnique.mockResolvedValue({ id: 'cm-9', content: 'x', taskId: 't1' })
    const { client } = replaying(load('issue-comment-missing.json'))

    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('delete')
    expect(db.task.findUnique.mock.calls[0][0].where).toEqual({ id: 't1' })
    expect(comments.deleteCommentWithSideEffects).toHaveBeenCalledWith(expect.objectContaining({ commentId: 'cm-9' }))
  })

  it('the App bot’s own comment (an agent’s, from Astrid) is never mirrored back', async () => {
    const { client } = replaying(load('issue-comment-app-bot.json'))
    expect(await syncRemoteComment('IC_kwDOVCns8c8AAAABa4hrQQ', client, NOW)).toBe('none')
    expect(db.comment.create).not.toHaveBeenCalled()
  })

  it('a person’s own push read back before its id was recorded is adopted, not duplicated', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-octo' })
    db.comment.findMany.mockResolvedValue([
      {
        id: 'cm-mine',
        authorId: 'u-octo',
        content: 'Reproduced on Safari 18 too — the date picker closes on scroll.',
        createdAt: new Date('2026-10-20T15:02:10Z'),
      },
    ])
    const { client } = replaying(load('issue-comment-person.json'))

    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('adopt')
    expect(db.comment.findMany.mock.calls[0][0].where).toMatchObject({ taskId: 't1', authorId: 'u-octo', remoteNodeId: null })
    expect(db.comment.update).toHaveBeenCalledWith({ where: { id: 'cm-mine' }, data: { remoteNodeId: PERSON_COMMENT } })
    expect(db.comment.create).not.toHaveBeenCalled()
    expect(comments.broadcastCommentCreated).not.toHaveBeenCalled()
  })

  it('two jobs racing on one comment: the loser’s unique violation is not a failure', async () => {
    db.comment.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    const { client } = replaying(load('issue-comment-person.json'))
    expect(await syncRemoteComment(PERSON_COMMENT, client, NOW)).toBe('none')
    expect(comments.broadcastCommentCreated).not.toHaveBeenCalled()
  })
})
