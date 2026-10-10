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

export const VIEWER_PERMISSIONS_QUERY = /* GraphQL */ `
query ProjectViewerPermissions($id: ID!) {
  node(id: $id) { ... on ProjectV2 { id viewerCanUpdate viewerCanClose } }
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

/** This user's role on a project, or null if they cannot see it. */
export async function fetchViewerRole(client: GraphqlClient, projectNodeId: string): Promise<BoardRole | null> {
  const data = await client.query<{ node: (ViewerPermissions & { id?: string }) | null }>(VIEWER_PERMISSIONS_QUERY, {
    id: projectNodeId,
  })
  return roleFromViewer(data.node && 'viewerCanUpdate' in data.node ? data.node : null)
}
