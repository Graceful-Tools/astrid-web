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
  customStates?: unknown
  lists?: Array<{ id: string }> | null
}

export async function fetchProjects(): Promise<ClientProject[]> {
  // apiGet throws on a non-2xx, so callers see a failed read as a rejection.
  const response = await apiGet('/api/v1/projects')
  const body = await response.json()
  return Array.isArray(body?.projects) ? body.projects : []
}
