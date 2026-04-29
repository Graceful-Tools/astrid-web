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
  if (list.ownerId === userId) return true
  if (list.admins && list.admins.some((admin: any) => admin.id === userId)) return true
  if (list.members && list.members.some((member: any) => member.id === userId)) return true
  if (list.listMembers && list.listMembers.some((member: any) => member.userId === userId)) return true
  return false
}

module.exports = { hasListAccess }
export {}
