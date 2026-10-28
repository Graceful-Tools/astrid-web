/**
 * RED for task 2e08b86d.
 *
 * GET /api/tasks/:id/comments ran an unbounded findMany with `author: true` on
 * both the comment and every reply, so a long agent thread returned hundreds of
 * FULL User rows — each carrying email, mcpSettings, webhookUrl and the email
 * verification token. On 2026-08-29 production logs show this endpoint killed
 * for running out of memory seven times on one task, with ~24 500s and
 * neighbouring requests failing as the instance died.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const ROUTES = [
  'app/api/lists/[id]/tasks/route.ts',
  'app/api/events/poll/route.ts',
]

describe.each(ROUTES)('%s', route => {
  const source = fs.readFileSync(route, 'utf8')

  it('never embeds a whole User row', () => {
    expect(source).not.toMatch(/\bauthor: true\b/)
    expect(source).not.toMatch(/\bassignee: true\b/)
    expect(source).not.toMatch(/\bcreator: true\b/)
  })

  it('selects users through the shared select', () => {
    expect(source).toContain('safeUserSelect')
  })
})

// The legacy /api/tasks/:id/comments this block used to read was deleted
// (AWTD-839). Its v1 successor bounds the list its own way: the newest
// TASK_COMMENTS_LIST_LIMIT, with total/truncated in meta, and no nested replies.
describe('comment list is bounded', () => {
  const source = fs.readFileSync('app/api/v1/tasks/[id]/comments/route.ts', 'utf8')

  it('caps how many comments one response can carry', () => {
    expect(source).toMatch(/take: TASK_COMMENTS_LIST_LIMIT/)
    expect(source).toMatch(/truncated/)
  })

  it('never embeds a whole User row', () => {
    expect(source).not.toMatch(/\bauthor: true\b/)
  })
})

describe('safeUserSelect', () => {
  it('carries no credential or verification fields', async () => {
    const { safeUserSelect } = await import('@/lib/user-select')

    for (const forbidden of ['emailVerificationToken', 'mcpSettings', 'webhookUrl', 'pendingEmail']) {
      expect(Object.keys(safeUserSelect)).not.toContain(forbidden)
    }
  })
})
