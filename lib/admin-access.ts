interface SessionLike {
  user?: { id?: string | null } | null
}

export type AdminAccessDecision = { allowed: true } | { redirectTo: '/auth/signin' | '/' }

/// Pure policy shared by the server layout and regression tests. Admin access
/// is derived from the authenticated user plus the existing AdminUser lookup.
export function resolveAdminAccess(
  session: SessionLike | null,
  hasAdminRecord: boolean
): AdminAccessDecision {
  if (!session?.user?.id) return { redirectTo: '/auth/signin' }
  if (!hasAdminRecord) return { redirectTo: '/' }
  return { allowed: true }
}
