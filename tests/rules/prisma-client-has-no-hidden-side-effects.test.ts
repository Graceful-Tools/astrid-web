/**
 * RULE — P1 step 3 of docs/specs/GITHUB_PROJECTS_WHITELABEL.md.
 *
 * lib/prisma.ts used to wrap the client in a `$extends` query hook that started
 * an AI-agent run whenever any code wrote `task.update({ assigneeId })`. A
 * business event implemented inside the database client is invisible at every
 * call site: a raw assignee write in POST /api/invitations became a billable
 * agent run for someone else (AWTD-1089), while `updateMany` and `create`
 * silently never dispatched at all.
 *
 * Agent dispatch now lives in services/agent-assignment-dispatch.ts, called by
 * the task service. The client stays a client.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('the Prisma client runs no business logic', () => {
  const source = readFileSync(join(process.cwd(), 'lib/prisma.ts'), 'utf8')

  it('installs no query hooks', () => {
    expect(source).not.toMatch(/\$extends\s*\(\s*\{\s*query/)
    expect(source).not.toMatch(/\bquery\s*:\s*\{\s*task\b/)
  })

  it('does not dispatch agents', () => {
    expect(source).not.toMatch(/handleTaskAssigneeChange|runAssistantWorkflow|sendToUserWebhook/)
  })
})
