/**
 * RED for task 49dcf609.
 *
 * Both public task feeds used `include: { assignee: true, creator: true, lists:
 * { include: { owner: true } } }`, which selects every scalar on User. Per the
 * schema that is email, pendingEmail, emailVerificationToken, mcpSettings (the
 * AI-credential blob) and webhookUrl. The legacy route needs no authentication
 * at all, so emailVerificationToken — enough to hijack a pending email change —
 * was on an open endpoint.
 *
 * Separately, `Math.min(parseInt(x), 200)` is NaN for a non-numeric limit,
 * which reaches Prisma's `take` and 500s. lib/pagination.ts already has
 * parseLimit for exactly this; these two routes never adopted it.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const ROUTES = [
  'app/api/public-tasks/route.ts',
  'app/api/v1/public/tasks/route.ts',
]

describe.each(ROUTES)('%s', route => {
  const source = fs.readFileSync(route, 'utf8')

  it('never includes a whole User row', () => {
    expect(source).not.toMatch(/assignee:\s*true/)
    expect(source).not.toMatch(/creator:\s*true/)
    expect(source).not.toMatch(/owner:\s*true/)
  })

  it('selects users through the shared public select', () => {
    expect(source).toContain('publicUserSelect')
  })

  it('parses limit and offset with the shared helper, not Math.min(parseInt())', () => {
    expect(source).toContain('parseLimit')
    expect(source).not.toMatch(/Math\.min\(\s*parseInt/)
  })
})

describe('publicUserSelect', () => {
  it('does not expose email or any credential field', async () => {
    const { publicUserSelect } = await import('@/lib/user-select')

    expect(Object.keys(publicUserSelect).sort()).toEqual(['id', 'image', 'isAIAgent', 'name'])
  })
})
