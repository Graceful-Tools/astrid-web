/**
 * List access predicate for the CommonJS MCP entry points.
 *
 * A user has access to a list if they own it, are an admin, are a legacy
 * direct member, or appear in the listMembers join table. The MCP call sites
 * pass a `list` shaped exactly as Prisma returns it.
 *
 * This used to DECLARE `hasListAccess` — the same name lib/list-member-utils.ts
 * exports, with the same body — so the codebase had two functions of one name
 * and one meaning, free to stop agreeing (task 3baa6e7c). It now delegates to
 * the canonical predicate instead of restating it, and declares no function of
 * its own; the file exists only because mcp-server-v2.ts and
 * mcp/handlers/tasks.ts `require()` this rather than importing ESM.
 */
const { hasExplicitListRole } = require("../lib/list-permissions")

module.exports = {
  hasListAccess: (list: any, userId: string): boolean =>
    hasExplicitListRole({ id: userId }, list),
}
export {}
