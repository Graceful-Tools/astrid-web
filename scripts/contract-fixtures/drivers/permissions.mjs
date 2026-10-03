// Runs astrid-web's list-permission rules over a case matrix and prints the results as JSON.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed, for the same reason as the repeating driver: these are branching
// rules with precedence between them, and the only honest way to lock precedence is to run the
// canonical implementation and record what it answers.
//
// WHAT THE CASES DELIBERATELY LEAVE OUT. `getUserRoleInList` also resolves a role from the list's
// project (project owner, project member, and the sibling-membership rule for status lists) and
// from two legacy denormalised arrays, `admins` and `members`. None of those fields exist on
// `V1List` — the shape a client actually receives from /api/v1/lists — so a client cannot reach
// those branches whatever it implements. Feeding them here would lock in answers no client can
// produce. The consequence for clients is real and is written up in astrid-core docs/CONTRACTS.md: a list
// reached through project membership arrives with the user in none of its `listMembers`, so a
// client computing the role locally sees no access at all.
//
// Usage: node scripts/contract-fixtures/drivers/permissions.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/permissions.mjs <path-to-astrid-web>')
  process.exit(2)
}

registerWebAliases(webRoot)

const permissions = await import(
  pathToFileURL(join(webRoot, 'lib/list-permissions.ts')).href
)
const {
  getUserRoleInList,
  canUserEditTasks,
  canUserEditTask,
  hasExplicitListRole,
  canUserManageList,
  canUserManageMembers,
  canUserDeleteList,
} = permissions

const USER = { id: 'user-me', email: 'me@example.test', name: 'Me' }
const OTHER = 'user-other'

/** A list carrying only fields V1List actually has. */
function list({ ownerId = OTHER, privacy = 'PRIVATE', publicListType = null, members = [], owner }) {
  return {
    id: 'list-1',
    ownerId,
    privacy,
    publicListType,
    owner: owner ?? { id: ownerId, name: null, email: 'owner@example.test' },
    listMembers: members,
  }
}

const member = (userId, role) => ({ userId, role, user: { id: userId, name: null, email: `${userId}@example.test` } })

const CASES = [
  // ── Ownership ────────────────────────────────────────────────────────────
  {
    name: 'owner by ownerId, private list',
    list: list({ ownerId: USER.id }),
  },
  {
    name: 'owner by the owner relation even when ownerId names somebody else',
    // Web checks `ownerId === user.id || owner?.id === user.id`. Surprising, but
    // canonical — a client that only compared ownerId would lock the real owner out.
    list: list({ ownerId: OTHER, owner: { id: USER.id, name: null, email: 'me@example.test' } }),
  },
  {
    name: 'owner of a public collaborative list',
    list: list({ ownerId: USER.id, privacy: 'PUBLIC', publicListType: 'collaborative' }),
  },

  // ── List membership, and how tolerant the role match is ──────────────────
  {
    name: 'admin member, lowercase role',
    list: list({ members: [member(USER.id, 'admin')] }),
  },
  {
    name: 'admin member, UPPERCASE role',
    // Rows like this exist: app/api/v1/lists created members as 'MEMBER'/'ADMIN'
    // (task e2803305). Casing must never decide access.
    list: list({ members: [member(USER.id, 'ADMIN')] }),
  },
  {
    name: 'admin member, MixedCase role',
    list: list({ members: [member(USER.id, 'Admin')] }),
  },
  {
    name: 'plain member, lowercase role',
    list: list({ members: [member(USER.id, 'member')] }),
  },
  {
    name: 'plain member, UPPERCASE role',
    list: list({ members: [member(USER.id, 'MEMBER')] }),
  },
  {
    name: 'membership with an unrecognised role still grants membership',
    // Presence in listMembers IS membership; the role only refines what it allows.
    list: list({ members: [member(USER.id, 'collaborator')] }),
  },
  {
    name: 'membership with an empty role still grants membership',
    list: list({ members: [member(USER.id, '')] }),
  },
  {
    name: 'membership matched through the nested user relation',
    // Some payloads carry the relation but not a matching userId.
    list: list({ members: [{ userId: 'stale-id', role: 'member', user: { id: USER.id, name: null, email: 'me@example.test' } }] }),
  },
  {
    name: 'membership of somebody else grants nothing',
    list: list({ members: [member(OTHER, 'admin')] }),
  },

  // ── Public lists ─────────────────────────────────────────────────────────
  {
    name: 'stranger on a public list with no publicListType',
    list: list({ privacy: 'PUBLIC', publicListType: null }),
  },
  {
    name: 'stranger on a public copy_only list',
    list: list({ privacy: 'PUBLIC', publicListType: 'copy_only' }),
  },
  {
    name: 'stranger on a public collaborative list',
    // The one case where a viewer may add tasks.
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative' }),
  },
  {
    name: 'member of a public copy_only list',
    list: list({ privacy: 'PUBLIC', publicListType: 'copy_only', members: [member(USER.id, 'member')] }),
  },
  {
    name: 'member of a public collaborative list',
    // Editing narrows to their OWN tasks here, unlike copy_only.
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative', members: [member(USER.id, 'member')] }),
  },
  {
    name: 'admin of a public collaborative list',
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative', members: [member(USER.id, 'admin')] }),
  },

  // ── No access ────────────────────────────────────────────────────────────
  {
    name: 'stranger on a private list',
    list: list({}),
  },
  {
    name: 'stranger on a shared list',
    list: list({ privacy: 'SHARED' }),
  },
  {
    name: 'member of a shared list',
    list: list({ privacy: 'SHARED', members: [member(USER.id, 'member')] }),
  },
  {
    name: 'private list with no members array at all',
    list: { id: 'list-1', ownerId: OTHER, privacy: 'PRIVATE', publicListType: null, owner: null, listMembers: [] },
  },
]

const ownTask = { id: 'task-own', title: 'own', creatorId: USER.id }
const otherTask = { id: 'task-other', title: 'theirs', creatorId: OTHER }

const cases = CASES.map(({ name, list: subject }) => ({
  name,
  list: subject,
  expected: {
    role: getUserRoleInList(USER, subject),
    // "Can see it" is "has a role in it". astrid-web exported that twice — `canUserViewList` was
    // `getUserRoleInList(...) !== null` and nothing more — and deleted the alias as unused, which
    // it was on that side. The rule is unchanged, so the fixture is too; only the spelling moved.
    canViewList: getUserRoleInList(USER, subject) !== null,
    canEditTasks: canUserEditTasks(USER, subject),
    // Split by authorship: on a public collaborative list the answer differs
    // between the two, and a single case would hide that.
    canEditOwnTask: canUserEditTask(USER, ownTask, subject),
    canEditOthersTask: canUserEditTask(USER, otherTask, subject),
    hasExplicitListRole: hasExplicitListRole(USER, subject),
    canManageList: canUserManageList(USER, subject),
    canManageMembers: canUserManageMembers(USER, subject),
    canDeleteList: canUserDeleteList(USER, subject),
  },
}))

process.stdout.write(
  JSON.stringify({
    generatedFrom: 'lib/list-permissions.ts',
    userId: USER.id,
    ownTaskCreatorId: ownTask.creatorId,
    othersTaskCreatorId: otherTask.creatorId,
    cases,
  }),
)
