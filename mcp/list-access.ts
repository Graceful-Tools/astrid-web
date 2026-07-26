/**
 * List access predicate.
 *
 * A user has access to a list if they own it, are an admin, are a legacy
 * direct member, or appear in the new listMembers join table. The MCP
 * server's call sites pass a `list` shaped exactly as Prisma returns it
 * with admins/members/listMembers included.
 *
 * Pure function — no IO, no this. Lives here so handler modules and the
 * legacy v2 server can share one definition.
 */
function hasListAccess(list: any, userId: string): boolean {
  // Delegates to the canonical role lookup (task e2803305). This had restated
  // it in full — ownerId, legacy admins[], legacy members[], listMembers — and
  // so was a fourth copy free to drift from the other three.
  const { hasExplicitListRole } = require("../lib/list-permissions")
  return hasExplicitListRole({ id: userId }, list)
}

module.exports = { hasListAccess }
export {}
