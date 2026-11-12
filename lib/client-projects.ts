/**
 * The client's read of `GET /api/v1/projects` — the projects the reader owns or
 * is a member of. One request shape shared by the hooks that need a project
 * fact the list payload does not carry (custom board states, task-id keys);
 * each hook keeps its own caching policy.
 */
import { apiGet } from '@/lib/api'

export interface ClientProject {
  id: string
  key?: string | null
  /** Keys this project had before a rename; ids under them still resolve (AWTD-1024). */
  keyAliases?: Array<{ key: string }> | null
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

/** What `loadProjectsOnce` already holds, without asking. */
export function peekLoadedProjects(): ClientProject[] | null {
  return cachedProjects
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function __clearLoadedProjectsCache() {
  cachedProjects = null
  inflightProjects = null
}
