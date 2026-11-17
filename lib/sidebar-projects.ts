/**
 * The sidebar's Projects section, as data (AWTD-1660; ADEV-14).
 *
 * astrid-core settles this core-first (docs/CONTRACTS.md D70, `rows/sidebar.rs`), and
 * packages/astrid-rules/fixtures/sidebar-projects.json locks it; the replay is
 * tests/lib/sidebar-projects-contract-adev-14.test.ts. The rules:
 *
 * 1. Every project the reader can see is a row, including one with no lists. No projects draws no
 *    section (`null`, never `[]`).
 * 2. Projects by name (falling back to the key), case folded, then id.
 * 3. A list sits under the project its own `projectId` names: never `Project.lists`, which is a
 *    nested copy that goes stale after a move. Only domain lists (no board columns or tags);
 *    repeats collapse to the first; a list naming a project the reader cannot see is only in Lists.
 *    Ordered by name, case folded, then id, as in the Lists section.
 * 4. A favourite sits under its project as well as in Favorites.
 * 5. Nothing is hidden or archived: the server's Project has no such field.
 */
import { isDomainList } from '@/lib/list-flavors'

export interface SidebarProjectInput {
  id: string
  name?: string | null
  key?: string | null
}

export interface SidebarListInput {
  id: string
  name?: string | null
  projectId?: string | null
  listType?: string | null
}

export interface SidebarProject<P extends SidebarProjectInput, L extends SidebarListInput> {
  project: P
  /** The project's name, else its key, else empty. */
  name: string
  lists: L[]
}

/**
 * The core's order: case-folded name, then id, compared by code unit rather than by locale, so
 * every reader and every client draws the same order.
 */
function byFoldedNameThenId(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left !== right) return left < right ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Keeps the first entry for each id. */
function firstById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
}

/** A project's sidebar name: its name, else its key, else empty (rule 2's fallback). */
export function sidebarProjectName(project: Pick<SidebarProjectInput, 'name' | 'key'>): string {
  return project.name || project.key || ''
}

export function sidebarProjects<P extends SidebarProjectInput, L extends SidebarListInput>(
  projects: readonly P[] | null | undefined,
  lists: readonly L[],
): SidebarProject<P, L>[] | null {
  if (!projects || projects.length === 0) return null
  const places = lists.filter(isDomainList)
  return firstById(projects)
    .map(project => ({
      project,
      id: project.id,
      name: sidebarProjectName(project),
      lists: firstById(places.filter(list => list.projectId === project.id))
        .map(list => ({ list, id: list.id, name: list.name || '' }))
        .sort(byFoldedNameThenId)
        .map(entry => entry.list),
    }))
    .sort(byFoldedNameThenId)
    .map(({ project, name, lists: projectLists }) => ({ project, name, lists: projectLists }))
}
