/**
 * RULE — the Postgres tier shares astrid_test with the e2e job, so an agent row it seeds must
 * carry the agent's real display name (ADEV-309).
 *
 * `tests/integration/postgres/agent-queue.test.ts` upserted `claude@` as `${mailbox} agent`
 * ("claude agent"). The e2e job runs against the same database, the task detail panel prints the
 * User row's name, and `e2e/agent-journey.spec.ts` expects "Claude": every PR went red on it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ADEV-309: Postgres-tier agent rows', () => {
  it('does not invent a lowercase "<mailbox> agent" display name', () => {
    const source = readFileSync(join(process.cwd(), 'tests/integration/postgres/agent-queue.test.ts'), 'utf8')
    expect(source).not.toContain('${mailbox} agent')
    expect(source).toContain('getAgentIdentity')
  })
})
