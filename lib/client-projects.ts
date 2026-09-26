/**
 * The client's read of `GET /api/v1/projects` — the projects the reader owns or
 * is a member of. One request shape shared by the hooks that need a project
 * fact the list payload does not carry (custom board states, task-id keys);
 * each hook keeps its own caching policy.
 */
export interface ClientProject {
  id: string
  key?: string | null
  customStates?: unknown
  lists?: Array<{ id: string }> | null
}

export async function fetchProjects(): Promise<ClientProject[]> {
  const response = await fetch('/api/v1/projects')
  if (!response.ok) throw new Error(`projects ${response.status}`)
  const body = await response.json()
  return Array.isArray(body?.projects) ? body.projects : []
}
