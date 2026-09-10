/**
 * Create and update must reach the SAME assignee decision (AWTD-891).
 *
 * `canUserAssignAgentToTask` (task 0672b69b) is the rule for pointing an AI
 * agent at a task, and it matters because an agent run spends the list's
 * configured user's API key and may execute code on their machine. AWTD-887
 * moved it behind `authorizeAssigneeChange` and wired the UPDATE path to it.
 * Nobody wired CREATE, which had grown its own inline copy of the *people*
 * rule and no agent rule at all — so the harder attack (rewrite someone's
 * task) was closed while the easier one (create a new task on a list you may
 * add to, pointed at an agent) stayed open for another two weeks.
 *
 * Two write paths reaching two different answers to one question is the shape
 * of the bug, not the detail of it, so this is a ratchet rather than a
 * behaviour test: whichever way the rule changes next, it changes for both.
 * The behaviour itself lives in tests/services/agent-assignment-on-create.test.ts
 * and tests/services/assignee-authorization.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICE = readFileSync(join(process.cwd(), 'services/task.service.ts'), 'utf8')
const AUTHORIZATION = readFileSync(join(process.cwd(), 'services/assignee-authorization.ts'), 'utf8')

/**
 * The two functions every task-write surface goes through (epic 9dedd8aa), and
 * the entry point each one is allowed to reach the rule through. Create's is a
 * thin wrapper because the two paths word the question slightly differently —
 * a task that does not exist yet has no creator but the actor, and a list's
 * `defaultAssigneeId` is not the caller's choice.
 */
const WRITE_PATHS = [
  ['createTaskWithSideEffects', 'authorizeNewTaskAssignee'],
  ['updateTaskWithSideEffects', 'authorizeAssigneeChange'],
] as const

/** The body of one exported service function, up to the next top-level export. */
function bodyOf(fn: string): string {
  const start = SERVICE.indexOf(`export async function ${fn}(`)
  expect(start, `${fn} not found in services/task.service.ts`).toBeGreaterThan(-1)
  const rest = SERVICE.slice(start + 1)
  const end = rest.indexOf('\nexport ')
  return end === -1 ? rest : rest.slice(0, end)
}

describe('the assignee rule reaches both task-write paths (AWTD-891)', () => {
  it.each(WRITE_PATHS)('%s decides its assignee through %s', (fn, entryPoint) => {
    expect(bodyOf(fn)).toMatch(new RegExp(`await ${entryPoint}\\(`))
  })

  it("create's entry point is a wrapper around the same decision, not a second one", () => {
    // Otherwise the indirection above becomes the place the answers diverge.
    const wrapper = AUTHORIZATION.slice(
      AUTHORIZATION.indexOf('export async function authorizeNewTaskAssignee(')
    )
    expect(wrapper).toMatch(/await authorizeAssigneeChange\(/)
  })

  it.each(WRITE_PATHS)('%s does not re-derive the people rule inline', (fn) => {
    const body = bodyOf(fn)

    // The exact hand-rolled check create used to carry. `assigneeCanBeAssigned`
    // is the people rule and belongs to the authorisation service; a list-role
    // scan over the *assignee* is that rule spelled out a second way, and the
    // two drifted the moment one of them learned about agents.
    expect(body).not.toMatch(/assigneeCanBeAssigned\(/)
    expect(body).not.toMatch(/hasListAccess\([^)]*assigneeId\)/)

    // Only ONE place may produce this string, or a caller cannot tell which
    // rule refused them and the next fix lands in the wrong file.
    expect(body).not.toContain('Assignee must be a member of one of the task lists')
  })

  it('the agent rule is not reachable from the service except through that function', () => {
    // task.service.ts must not import the low-level agent predicate at all:
    // calling it directly is how a third answer to the question gets written.
    expect(SERVICE).not.toMatch(/canUserAssignAgentToTask/)
  })
})
