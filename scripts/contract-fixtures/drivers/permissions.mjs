// Runs astrid-web's list-permission rules over a case matrix and prints the results as JSON.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// Executed rather than parsed, for the same reason as the repeating driver: these are branching
// rules with precedence between them, and the only honest way to lock precedence is to run the
// canonical implementation and record what it answers.
//
// WHAT THE CASES COVER. Besides what a client receives on `V1List` (ownership, `listMembers`,
// privacy), `getUserRoleInList` resolves a role from the list's project — the project owner, a
// project member, and the sibling-membership rule for status lists — and from two legacy
// denormalised arrays, `admins` and `members`. Those fields are not on the wire, so a *client*
// still cannot reach those branches (astrid-core docs/CONTRACTS.md §5). The *server* can: astrid-web decides
// with the project and the legacy arrays loaded, and decides through this crate (AWTD-1061). So
// every one of those branches is locked here, and their precedence against the rest, as web runs
// them. A client that sends none of those fields gets exactly the answers it got before.
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

/**
 * A list as the server loads it. Only the V1List fields unless a case passes the server-only ones:
 * `extra` carries `listType`, `project` and the legacy `admins` array. `members` here is
 * `listMembers` (as it always was in this table), so the legacy `members` array is spelled
 * `legacyMembers`.
 */
function list({ ownerId = OTHER, privacy = 'PRIVATE', publicListType = null, members = [], owner, legacyMembers, ...extra }) {
  return {
    id: 'list-1',
    ownerId,
    privacy,
    publicListType,
    owner: owner ?? { id: ownerId, name: null, email: 'owner@example.test' },
    listMembers: members,
    ...(legacyMembers === undefined ? {} : { members: legacyMembers }),
    ...extra,
  }
}

const member = (userId, role) => ({ userId, role, user: { id: userId, name: null, email: `${userId}@example.test` } })
const ref = (id) => ({ id, name: null, email: `${id}@example.test` })

/** A project as PROJECT_ACCESS_INCLUDE loads it: owner, members, and every list's members. */
function project({ ownerId = 'user-project-owner', members = [], lists = [] } = {}) {
  return { id: 'project-1', ownerId, members, lists }
}
const projectMember = (userId, role) => ({ userId, role })
/** A sibling list in the same project, carrying only its members (that is all the include loads). */
const sibling = (id, ...userIds) => ({ id, listMembers: userIds.map((userId) => ({ userId })) })

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

  // ── Legacy denormalised arrays (server-only; AWTD-1061) ──────────────────
  {
    name: 'legacy admins array grants admin',
    list: list({ admins: [ref(USER.id)] }),
  },
  {
    name: 'legacy members array grants member',
    list: list({ legacyMembers: [ref(USER.id)] }),
  },
  {
    name: 'legacy admins array beats a plain list membership',
    // Order in web: membership admin, then the admins array, then any membership.
    list: list({ members: [member(USER.id, 'member')], admins: [ref(USER.id)] }),
  },
  {
    name: 'legacy admins array beats the legacy members array',
    list: list({ legacyMembers: [ref(USER.id)], admins: [ref(USER.id)] }),
  },
  {
    name: 'an admin membership is not lowered by the legacy members array',
    list: list({ members: [member(USER.id, 'admin')], legacyMembers: [ref(USER.id)] }),
  },
  {
    name: 'ownership is not lowered by the legacy arrays',
    list: list({ ownerId: USER.id, admins: [ref(USER.id)], legacyMembers: [ref(USER.id)] }),
  },
  {
    name: 'legacy arrays naming somebody else grant nothing',
    list: list({ admins: [ref(OTHER)], legacyMembers: [ref(OTHER)] }),
  },
  {
    name: 'empty legacy arrays grant nothing',
    list: list({ admins: [], legacyMembers: [] }),
  },
  {
    name: 'legacy member of a public collaborative list is a member, not a viewer',
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative', legacyMembers: [ref(USER.id)] }),
  },
  {
    name: 'legacy admin of a public copy_only list',
    list: list({ privacy: 'PUBLIC', publicListType: 'copy_only', admins: [ref(USER.id)] }),
  },

  // ── Project roles (server-only; task 6c20d125, AWTD-1061) ────────────────
  {
    name: 'project owner is an admin of the list, never its owner',
    // Owning the project must not grant the power to delete a list somebody else owns.
    list: list({ project: project({ ownerId: USER.id }) }),
  },
  {
    name: 'project owner who also owns the list is its owner',
    list: list({ ownerId: USER.id, project: project({ ownerId: USER.id }) }),
  },
  {
    name: 'project member with role member',
    list: list({ project: project({ members: [projectMember(USER.id, 'member')] }) }),
  },
  {
    name: 'project member with role admin',
    list: list({ project: project({ members: [projectMember(USER.id, 'admin')] }) }),
  },
  {
    name: 'project member with role ADMIN — casing never decides access',
    list: list({ project: project({ members: [projectMember(USER.id, 'ADMIN')] }) }),
  },
  {
    name: 'project member with role Admin',
    list: list({ project: project({ members: [projectMember(USER.id, 'Admin')] }) }),
  },
  {
    name: 'project member with an unrecognised role is a member',
    list: list({ project: project({ members: [projectMember(USER.id, 'collaborator')] }) }),
  },
  {
    name: 'project member with no role is a member',
    list: list({ project: project({ members: [projectMember(USER.id, null)] }) }),
  },
  {
    name: 'project membership of somebody else grants nothing',
    list: list({ project: project({ members: [projectMember(OTHER, 'admin')] }) }),
  },
  {
    name: 'project member of a public copy_only list is a member, not a viewer',
    list: list({ privacy: 'PUBLIC', publicListType: 'copy_only', project: project({ members: [projectMember(USER.id, 'member')] }) }),
  },
  {
    name: 'project member of a public collaborative list is a member, not a viewer',
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative', project: project({ members: [projectMember(USER.id, 'member')] }) }),
  },
  {
    name: 'stranger to the project on a public list is a viewer',
    list: list({ privacy: 'PUBLIC', project: project({ members: [projectMember(OTHER, 'member')] }) }),
  },
  {
    name: 'a list admin who is only a project member stays an admin',
    list: list({ members: [member(USER.id, 'admin')], project: project({ members: [projectMember(USER.id, 'member')] }) }),
  },
  // The HIGHER of the list role and the project role wins (Jon, 2026-10-04). Until then list
  // membership was consulted first, so the three cases below were all "member".
  {
    name: 'a plain list member who is a project admin is an admin of the list',
    list: list({ members: [member(USER.id, 'member')], project: project({ members: [projectMember(USER.id, 'admin')] }) }),
  },
  {
    name: 'a plain list member who owns the project is an admin of the list, never its owner',
    list: list({ members: [member(USER.id, 'member')], project: project({ ownerId: USER.id }) }),
  },
  {
    name: 'a legacy-array member who owns the project is an admin of the list',
    list: list({ legacyMembers: [ref(USER.id)], project: project({ ownerId: USER.id }) }),
  },
  {
    name: 'a plain list member with an UPPERCASE role who is a project ADMIN is an admin',
    list: list({ members: [member(USER.id, 'MEMBER')], project: project({ members: [projectMember(USER.id, 'ADMIN')] }) }),
  },
  {
    name: 'a plain list member who is a plain project member stays a member',
    list: list({ members: [member(USER.id, 'member')], project: project({ members: [projectMember(USER.id, 'member')] }) }),
  },
  {
    name: 'a plain list member who owns the project, on a public collaborative list, is an admin',
    // Admin, not the narrower authorship rule a member gets on a collaborative list.
    list: list({ privacy: 'PUBLIC', publicListType: 'collaborative', members: [member(USER.id, 'member')], project: project({ ownerId: USER.id }) }),
  },
  {
    name: 'status list: a plain member of it who administers the project is an admin',
    list: list({ listType: 'status', members: [member(USER.id, 'member')], project: project({ members: [projectMember(USER.id, 'admin')], lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'project with no owner and no members grants nothing',
    list: list({ project: { id: 'project-1' } }),
  },
  {
    name: 'project: null is no project',
    list: list({ project: null }),
  },

  // ── Status-list cascade (server-only; task 142e4dd9, AWTD-1061) ─────────
  {
    name: 'status list: a member of a sibling list may work its columns',
    list: list({ listType: 'status', project: project({ lists: [sibling('domain-1', OTHER, USER.id)] }) }),
  },
  {
    name: 'status list: sibling membership on a public collaborative list is member, not viewer',
    list: list({ listType: 'status', privacy: 'PUBLIC', publicListType: 'collaborative', project: project({ lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'status list: the second of several siblings is enough',
    list: list({ listType: 'status', project: project({ lists: [sibling('domain-1', OTHER), sibling('domain-2', USER.id)] }) }),
  },
  {
    name: 'status list: siblings shared with somebody else grant nothing',
    list: list({ listType: 'status', project: project({ lists: [sibling('domain-1', OTHER)] }) }),
  },
  {
    name: 'status list: siblings without loaded members grant nothing',
    list: list({ listType: 'status', project: project({ lists: [{ id: 'domain-1' }, { id: 'domain-2', listMembers: null }] }) }),
  },
  {
    name: 'status list: a project without loaded lists grants nothing',
    list: list({ listType: 'status', project: { id: 'project-1', ownerId: 'user-project-owner', members: [] } }),
  },
  {
    name: 'status list with no project grants nothing',
    list: list({ listType: 'status' }),
  },
  {
    name: 'status list: a project admin keeps admin over the cascade',
    list: list({ listType: 'status', project: project({ members: [projectMember(USER.id, 'admin')], lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'status list: the project owner is an admin',
    list: list({ listType: 'status', project: project({ ownerId: USER.id, lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'status list: its own owner stays owner',
    list: list({ listType: 'status', ownerId: USER.id, project: project({ lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'domain list: sibling membership does NOT cascade',
    // Sharing one list in a project must not silently share its siblings.
    list: list({ listType: 'regular', project: project({ lists: [sibling('domain-2', USER.id)] }) }),
  },
  {
    name: 'list with no listType: sibling membership does NOT cascade',
    list: list({ project: project({ lists: [sibling('domain-2', USER.id)] }) }),
  },
  {
    name: 'listType STATUS in capitals is not a status list',
    // Web compares listType exactly; only role strings are case-insensitive.
    list: list({ listType: 'STATUS', project: project({ lists: [sibling('domain-1', USER.id)] }) }),
  },
  {
    name: 'domain list on a public list: sibling membership leaves a viewer',
    list: list({ listType: 'regular', privacy: 'PUBLIC', project: project({ lists: [sibling('domain-2', USER.id)] }) }),
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
