/**
 * Board roles derived from GitHub (AWTD-1153, spec §8.6).
 *
 * Asked with each USER's own token, so the answer is GitHub's permission model,
 * not a copy of it:
 *
 *   can close the project (project admin / org owner)  → admin
 *   can update it (write)                              → member
 *   can see it (read)                                  → viewer
 *   cannot see it                                      → no membership
 */

import type { GraphqlClient } from '../rate-limiter'

export type BoardRole = 'admin' | 'member' | 'viewer'

/**
 * Also asks who the viewer IS: the user's GitHub node id is what GitHub
 * assigns by (AWTD-1116 P5c). Every board member passes through here with
 * their own token, so the identity is recorded for exactly the people who
 * can be assigned — at no extra request.
 */
export const VIEWER_PERMISSIONS_QUERY = /* GraphQL */ `
query ProjectViewerPermissions($id: ID!) {
  node(id: $id) { ... on ProjectV2 { id viewerCanUpdate viewerCanClose } }
  viewer { id databaseId }
  rateLimit { cost remaining resetAt }
}`

export interface ViewerPermissions {
  viewerCanUpdate: boolean
  viewerCanClose: boolean
}

export function roleFromViewer(viewer: ViewerPermissions | null): BoardRole | null {
  if (!viewer) return null
  if (viewer.viewerCanClose) return 'admin'
  if (viewer.viewerCanUpdate) return 'member'
  return 'viewer'
}

export interface GithubIdentity {
  nodeId: string
  databaseId: number
}

/** This user's role on a project (null if they cannot see it), and who they are on GitHub. */
export async function fetchViewerRole(
  client: GraphqlClient,
  projectNodeId: string,
): Promise<{ role: BoardRole | null; identity: GithubIdentity | null }> {
  const data = await client.query<{
    node: (ViewerPermissions & { id?: string }) | null
    viewer?: { id: string; databaseId: number }
  }>(VIEWER_PERMISSIONS_QUERY, { id: projectNodeId })
  return {
    role: roleFromViewer(data.node && 'viewerCanUpdate' in data.node ? data.node : null),
    identity: data.viewer ? { nodeId: data.viewer.id, databaseId: data.viewer.databaseId } : null,
  }
}
