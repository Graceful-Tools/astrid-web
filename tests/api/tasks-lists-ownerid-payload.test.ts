/**
 * The tasks payload must carry `ownerId` on each list (task 5208e723 —
 * "some tasks in Astrid web to-do list are read-only!").
 *
 * WHY A MISSING FIELD MAKES TASKS READ-ONLY
 * -----------------------------------------
 * TaskManagerView decides editability with:
 *
 *     const taskList = selectedTask.lists?.[0] || lists.find(...)
 *     const canEdit  = canUserEditTask(user, selectedTask, taskList)
 *
 * and canUserEditTask defers to getUserRoleInList, which resolves OWNER from
 * `list.ownerId` (or a loaded `owner` relation) and MEMBER from `listMembers`.
 *
 * The GET selected id, name, color, githubRepositoryId and — only when not in
 * lean mode — listMembers. No ownerId. So an owner who is not ALSO a member
 * row resolves to no role at all, and the task renders read-only.
 *
 * WHY ONLY *SOME* TASKS, which is what made this confusing:
 * production data on the reporting account shows
 *
 *   Astrid Web To-do  ownerId=Jon, and ALSO a listMembers row (admin)
 *   Doing / Waiting   ownerId=Jon, NO listMembers row
 *
 * The board resolves through membership, so single-list tasks were fine. But
 * `lists[0]` is the STATUS list for any task carrying a status, and there the
 * only route to a role was the ownerId that never arrived. Give a task a
 * status and it turns read-only — exactly the report, and exactly Jon's guess
 * ("might be because these have state variable (waiting, review)").
 *
 * Fixing the payload rather than the call site: ownerId is what
 * getUserRoleInList documents itself as needing, its absence breaks every
 * consumer rather than this one, and lean mode drops listMembers entirely —
 * which leaves ownerId as the ONLY way to resolve an owner at all.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const routes = [
  'app/api/v1/tasks/route.ts',
  'app/api/tasks/route.ts',
]

/**
 * The `lists: { select | include: { ... } }` blocks in a route file.
 *
 * BOTH forms count, because the requirement is not a particular keyword — it
 * is that the payload lets getUserRoleInList resolve an owner. It accepts
 * either `ownerId` or a loaded `owner` relation, and the legacy route has
 * always used the latter (`include: { owner: { select: safeUserSelect } }`).
 * An earlier version of this test looked only for `ownerId: true` inside a
 * `select`, and so failed a route that was never broken.
 */
function listSelectBlocks(src: string): string[] {
  const blocks: string[] = []
  const re = /lists:\s*\{\s*(?:select|include):\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    // Walk braces from the opening of the select object to its match.
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    blocks.push(src.slice(re.lastIndex, i))
  }
  return blocks
}

describe('task list payloads carry ownerId (task 5208e723)', () => {
  it.each(routes)('%s selects ownerId on every lists select', file => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    const blocks = listSelectBlocks(src)

    expect(blocks.length, `no lists select found in ${file}`).toBeGreaterThan(0)

    // Either shape satisfies getUserRoleInList.
    // `owner: true` and `owner: { select: ... }` both load the relation, and
    // getUserRoleInList reads `list.owner?.id` either way. Matching on the key
    // rather than a particular value: this assertion has been narrowed twice
    // already by writing down one syntax instead of the requirement.
    const missing = blocks.filter(b => !/\bownerId:\s*true/.test(b) && !/\bowner:/.test(b))
    expect(
      missing.length,
      `a lists payload that carries neither ownerId nor the owner relation — ` +
        `an owner who is not also a member row resolves to no role, and the ` +
        `task renders read-only:\n${missing.join('\n---\n')}`,
    ).toBe(0)
  })
})

describe('the permission consequence (task 5208e723)', () => {
  it('an owner resolves to no role when ownerId is stripped from the payload', async () => {
    const { getUserRoleInList } = await import('@/lib/list-permissions')
    const user = { id: 'jon' }

    // What the server knows.
    const full = { id: 'l1', ownerId: 'jon', listMembers: [] }
    expect(getUserRoleInList(user as never, full as never)).toBe('owner')

    // What the client used to receive for a status list: no ownerId, and no
    // membership row because owning a list does not create one.
    const stripped = { id: 'l1', listMembers: [] }
    expect(getUserRoleInList(user as never, stripped as never)).toBeNull()
  })

  it('membership alone still resolves, which is why the board kept working', async () => {
    const { getUserRoleInList } = await import('@/lib/list-permissions')
    const boardWithoutOwnerId = {
      id: 'board',
      listMembers: [{ userId: 'jon', role: 'admin' }],
    }
    expect(getUserRoleInList({ id: 'jon' } as never, boardWithoutOwnerId as never)).toBe('admin')
  })
})
