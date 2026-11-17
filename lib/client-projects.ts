/**
 * The client's read of `GET /api/v1/projects` — the projects the reader owns or
 * is a member of. One request shape shared by the hooks that need a project
 * fact the list payload does not carry (custom board states, task-id keys);
 * each hook keeps its own caching policy.
 */
import { apiGet } from '@/lib/api'

export interface ClientProject {
  id: string
  /** The board's name, drawn in the sidebar's Projects section (AWTD-1660). */
  name?: string | null
  key?: string | null
  /** Keys this project had before a rename; ids under them still resolve (AWTD-1024). */
  keyAliases?: Array<{ key: string }> | null
  /** Who may move a list in or out, and create in it (AWTD-1703, lib/list-project-moves.ts). */
  ownerId?: string | null
  members?: Array<{ userId: string; role?: string | null }> | null
  customStates?: unknown
  lists?: Array<{ id: string }> | null
}

export async function fetchProjects(): Promise<ClientProject[]> {
  // apiGet throws on a non-2xx, so callers see a failed read as a rejection.
  const response = await apiGet('/api/v1/projects')
  const body = await response.json()
  return Array.isArray(body?.projects) ? body.projects : []
}

let cachedProjects: ClientProject[] | null = null
let inflightProjects: Promise<ClientProject[]> | null = null
const projectListeners = new Set<(projects: ClientProject[]) => void>()

/**
 * Hear when `loadProjectsOnce` lands — including a later caller's retry after
 * a failed first read, so rows mounted before it are not left without boards.
 */
export function subscribeLoadedProjects(listener: (projects: ClientProject[]) => void): () => void {
  projectListeners.add(listener)
  return () => {
    projectListeners.delete(listener)
  }
}

/**
 * The projects, read once per page load and shared by every caller that is
 * content with that (task-id links, the list row's board-status pill). A board
 * created or renamed since then shows after a reload. A failed read is not
 * cached, so the next caller retries.
 */
export function loadProjectsOnce(): Promise<ClientProject[]> {
  if (cachedProjects) return Promise.resolve(cachedProjects)
  if (!inflightProjects) {
    inflightProjects = fetchProjects()
      .then(result => {
        cachedProjects = result
        for (const listener of projectListeners) listener(result)
        return result
      })
      .finally(() => {
        inflightProjects = null
      })
  }
  return inflightProjects
}

/**
 * Show a rename now, in the sidebar and on the open board, instead of after a
 * reload (ADEV-54). A project not in the cache is left alone.
 */
export function renameLoadedProject(projectId: string, name: string) {
  if (!cachedProjects) return
  cachedProjects = cachedProjects.map(project => (project.id === projectId ? { ...project, name } : project))
  for (const listener of projectListeners) listener(cachedProjects)
}

/** Drop a deleted project from the sidebar and the open board now, not after a reload (ADEV-61). */
export function removeLoadedProject(projectId: string) {
  if (!cachedProjects) return
  cachedProjects = cachedProjects.filter(project => project.id !== projectId)
  for (const listener of projectListeners) listener(cachedProjects)
}

/** What `loadProjectsOnce` already holds, without asking. */
export function peekLoadedProjects(): ClientProject[] | null {
  return cachedProjects
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function __clearLoadedProjectsCache() {
  cachedProjects = null
  inflightProjects = null
}
