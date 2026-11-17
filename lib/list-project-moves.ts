/**
 * Where a list may move between projects, and where a new list may be made (AWTD-1703).
 *
 * MIRRORS astrid-core `astrid_rules::list_project_moves` (D68, astrid-ios AITD-680) — the one
 * table iOS, Mac and the web all draw the list settings "Project" control from, and the table
 * `PUT /api/v1/lists/:id` / `POST /api/v1/lists` enforce (AWTD-1702). It is a copy only because
 * the browser cannot call the core yet (the vendored WebAssembly is server-only). Replace it with
 * the core's `listProjectMoves` request when a browser build of the rules door lands. Until then
 * tests/lib/list-project-moves-awtd-1703.test.ts holds it to every case in the core's own fixture.
 */

export interface MovesMember {
  userId: string
  role?: string | null
}

export interface MovesProject {
  id: string
  name?: string | null
  ownerId?: string | null
  members?: MovesMember[] | null
}

export interface MovesList {
  id?: string
  ownerId?: string | null
  projectId?: string | null
  listType?: string | null
  listMembers?: MovesMember[] | null
}

export interface ListProjectMoves {
  canLeave: boolean
  /** Projects the list may move into, never its current one, ordered by name. */
  destinations: string[]
  /** Projects a new list may be made in, ordered by name. */
  creatableIn: string[]
}

const PROJECT_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } as const
type ProjectRole = keyof typeof PROJECT_RANK

/** Presence is membership: a row with a missing or unknown role is a member. Case-blind. */
function projectRole(userId: string, project: MovesProject): ProjectRole | null {
  if (!userId) return null
  // eslint-disable-next-line no-restricted-syntax -- a project's owner, as the core rule reads it
  if (project.ownerId === userId) return 'owner'
  const row = (project.members ?? []).find(member => member.userId === userId)
  if (!row) return null
  const role = (row.role ?? '').toLowerCase()
  return role === 'owner' || role === 'admin' || role === 'viewer' ? role : 'member'
}

const atLeast = (role: ProjectRole | null, floor: ProjectRole) =>
  role !== null && PROJECT_RANK[role] >= PROJECT_RANK[floor]

const runs = (userId: string, project: MovesProject) => atLeast(projectRole(userId, project), 'admin')

/** Owner or project admin: who the server lets rename a project (ADEV-48) and open its settings (ADEV-54). */
export const mayAdministerProject = runs

/** Only the owner: who the server lets delete a project (DELETE /api/v1/projects/:id; iOS ADEV-46). */
export const mayDeleteProject = (userId: string, project: MovesProject): boolean =>
  projectRole(userId, project) === 'owner'

/** Owner or admin of the list by its own ownership and membership, never the project's cascade. */
function mayMoveList(userId: string, list: MovesList): boolean {
  if (list.listType === 'status') return false
  // Inline on purpose: this mirrors the core rule, which reads the list's OWN ownership and
  // membership and deliberately not the project cascade that lib/list-permissions adds.
  // eslint-disable-next-line no-restricted-syntax
  if (list.ownerId === userId) return true
  return (list.listMembers ?? []).some(
    member => member.userId === userId && (member.role ?? '').toLowerCase() === 'admin',
  )
}

function mayLeave(userId: string, list: MovesList, from: MovesProject | null): boolean {
  if (!list.projectId) return true
  return from !== null && from.id === list.projectId && runs(userId, from)
}

export function canMoveList(
  userId: string,
  list: MovesList,
  from: MovesProject | null,
  to: MovesProject | null,
): boolean {
  if ((list.projectId ?? null) === (to?.id ?? null)) return false
  return mayMoveList(userId, list) && mayLeave(userId, list, from) && (to === null || runs(userId, to))
}

/** Projects by name, case-blind, then by id so equal names keep one order everywhere. */
function byName(projects: MovesProject[]): string[] {
  return [...projects]
    .sort((a, b) => {
      const an = (a.name ?? '').toLowerCase()
      const bn = (b.name ?? '').toLowerCase()
      return an < bn ? -1 : an > bn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map(project => project.id)
}

/** Everything a list's project control offers at once. With no list, only `creatableIn`. */
export function listProjectMoves(
  userId: string,
  list: MovesList | null,
  projects: MovesProject[],
): ListProjectMoves {
  const creatableIn = byName(projects.filter(project => atLeast(projectRole(userId, project), 'member')))
  if (!list) return { canLeave: false, destinations: [], creatableIn }
  const from = list.projectId ? (projects.find(project => project.id === list.projectId) ?? null) : null
  return {
    canLeave: Boolean(list.projectId) && canMoveList(userId, list, from, null),
    destinations: byName(projects.filter(project => canMoveList(userId, list, from, project))),
    creatableIn,
  }
}
