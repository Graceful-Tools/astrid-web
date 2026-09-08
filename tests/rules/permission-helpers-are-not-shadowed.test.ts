/**
 * RULE — task 3baa6e7c.
 *
 * Three routes declared their own `canAccessList`, while
 * lib/list-member-utils.ts exports a function of that exact name. The obvious
 * cleanup — "delete the copies, import the shared one" — is a SECURITY
 * REGRESSION, and that is the whole reason this rule exists:
 *
 *   lib/list-member-utils.ts canAccessList  →  true for ANY list whose
 *                                              privacy is 'PUBLIC'
 *   the three local copies                  →  hasListAccess() only, i.e.
 *                                              membership, full stop
 *
 * So the local copies were never a duplicate of the export. They were thin
 * aliases for `hasListAccess` wearing a name that already meant something
 * laxer, on the task, comment and secure-file routes. Anyone "deduplicating"
 * them by reaching for the shared helper would have widened access to every
 * public list without a single test going red.
 *
 * The fix was to delete the wrappers and call `hasListAccess` directly, which
 * is what they did. This rule stops the shape coming back: a module-local
 * function may not take the name of an exported permission helper, because the
 * next reader cannot tell which semantics they are looking at, and the
 * dangerous move looks like tidying.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** The permission modules whose exported names are reserved. */
const PERMISSION_MODULES = ['lib/list-permissions.ts', 'lib/list-member-utils.ts']

/** Directories that must not shadow those names. */
const SCANNED = ['app', 'components', 'hooks', 'services', 'mcp']

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function exportedFunctionNames(file: string): string[] {
  const src = readFileSync(join(ROOT, file), 'utf8')
  return [...src.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map(m => m[1])
}

/**
 * Only PREDICATES are reserved — `canX`, `hasX`, `isX`.
 *
 * A local getter that happens to share a name with an exported one is untidy;
 * a local PREDICATE that shares a name with an exported one silently answers
 * an access question differently, and looks like a tidy-up when someone
 * "deduplicates" it. That second thing is what this rule is for, so it is what
 * it scans for. (`getListMembers` is shadowed in two MCP handlers today; that
 * is a naming cleanup, not an access decision, and is deliberately out of
 * scope here rather than quietly bundled in.)
 */
const RESERVED = new Set(
  PERMISSION_MODULES.flatMap(exportedFunctionNames).filter(n => /^(can|has|is)[A-Z]/.test(n)),
)

describe('permission helper names are not shadowed by local copies', () => {
  it('has reserved names to check, so the rule cannot pass by finding nothing', () => {
    // A regex that silently stops matching would make every assertion below
    // vacuous. Pin that it found the helpers this rule is actually about.
    expect(RESERVED.has('canAccessList')).toBe(true)
    expect(RESERVED.has('hasListAccess')).toBe(true)
    expect(RESERVED.size).toBeGreaterThan(5)
  })

  it('no file declares a function using a name the permission modules export', () => {
    const offenders: string[] = []

    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const src = readFileSync(file, 'utf8')
        for (const match of src.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
          if (RESERVED.has(match[1])) {
            offenders.push(`${relative(ROOT, file)} declares ${match[1]}`)
          }
        }
        for (const match of src.matchAll(/^\s*const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/gm)) {
          if (RESERVED.has(match[1])) {
            offenders.push(`${relative(ROOT, file)} declares ${match[1]}`)
          }
        }
      }
    }

    // Import the helper, or pick a name that says what yours actually does.
    // Do NOT reach for the shared canAccessList to satisfy this — read the
    // file header first; the two have different answers for PUBLIC lists.
    expect(offenders).toEqual([])
  })
})

/**
 * The same task's other half: `{ listMembers: { some: { userId } } }` repeated
 * two and three times inside ONE `OR`, at six call sites.
 *
 * It is vestigial. The admins[]/members[]/listMembers migration collapsed three
 * different clauses into one shape and nobody deleted the duplicates, so the
 * query asked the identical question three times. Harmless to the planner and
 * badly misleading to a reader, who reasonably assumes three clauses check
 * three things.
 *
 * The real cost is that these are hand-rolled: they omit the project-membership
 * and status-list branches that `listVisibilityWhere` carries, so MCP and the
 * event poller showed a project member LESS than the web did for the same list.
 * That is the divergence class epic 9dedd8aa kept turning up.
 */
describe('list visibility is not hand-rolled', () => {
  it('no OR repeats the same listMembers clause', () => {
    const offenders: string[] = []
    const clause = /\{\s*listMembers:\s*\{\s*some:\s*\{\s*userId:/

    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const lines = readFileSync(file, 'utf8').split('\n')
        for (let i = 1; i < lines.length; i++) {
          // Two identical consecutive clauses is the signature; one is a
          // legitimate single membership check.
          if (clause.test(lines[i]) && lines[i].trim() === lines[i - 1].trim()) {
            offenders.push(`${relative(ROOT, file)}:${i + 1}`)
          }
        }
      }
    }

    // Use listVisibilityWhere() from lib/list-permissions.ts, which states the
    // rule once and includes the project branches these omit.
    expect(offenders).toEqual([])
  })
})
