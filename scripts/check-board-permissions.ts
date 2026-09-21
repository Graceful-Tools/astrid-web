#!/usr/bin/env tsx
/**
 * Does THIS MACHINE let a scheduled /fixall run call the Astrid board? (AWTD-975)
 *
 * `.claude/settings.local.json` is gitignored (.claude/README.md), so the
 * checked-in template being right says nothing about the checkout the loop
 * actually runs in. A fresh clone, or a local file drifting, reproduces the
 * original bug with a completely green test suite.
 *
 * THE ORIGINAL BUG WAS SILENT. The first unattended web run (2026-09-19) had
 * every `mcp__astrid__*` call denied — there is no terminal to answer a
 * permission prompt in — fell back to the OAuth scripts, and logged
 * `RESULT: OK`. The fallback works for the queue, but it cannot see
 * `attention`, which arrives only on `get_agent_queue`, so the loop was deaf to
 * anything said to it (AWTD-963). Nothing in the log distinguished that from a
 * healthy run, which is the entire reason this file exists.
 *
 * Run by `scripts/fixall-loop.sh` at startup, where it WARNS and continues: a
 * degraded run still gets the work done, and turning one missing line in a
 * gitignored file into a loop that never runs would be the worse failure.
 *
 *   npx tsx scripts/check-board-permissions.ts [path-to-settings.json]
 *
 * Exit 0 = every board tool is pre-approved. Exit 1 = something is missing, and
 * stdout names it.
 *
 * IT LIVES IN scripts/ RATHER THAN .claude/ because Claude Code treats
 * `.claude/**` as a protected path and refuses to write there mid-run — which
 * is correct, and is exactly why AWTD-975 had to be filed for a human instead
 * of fixed by the run that found it. A checker the loop cannot maintain is a
 * checker that rots.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { removeComments } from '../.claude/validate-settings'

/**
 * The board tools a `/fixall` run calls, as they appear in `permissions.allow`.
 *
 * Named individually rather than as `mcp__astrid__*` on purpose: a wildcard
 * would also pre-approve whatever is added to that server later, and the ask
 * here is the board tools, not a standing grant. Held to the server's real tool
 * list by tests/rules/scheduled-loop-can-call-the-board.test.ts, because a typo
 * in an allowlist entry fails exactly like a missing one.
 */
export const BOARD_TOOLS_THE_LOOP_NEEDS = [
  'mcp__astrid__get_agent_queue',
  'mcp__astrid__get_lists',
  'mcp__astrid__get_tasks',
  'mcp__astrid__get_task',
  'mcp__astrid__get_task_comments',
  'mcp__astrid__get_list_messages',
  'mcp__astrid__add_comment',
  'mcp__astrid__update_task',
  'mcp__astrid__create_task',
] as const

/**
 * The pushes a finished `/fixall` run makes (AWTD-978).
 *
 * An `ask` entry matching any of these stops the run from publishing its work:
 * `ask` means PROMPT, and `claude -p` has no terminal to answer a prompt in. The
 * scheduled run of 2026-09-20 finished two tasks with predeploy green and then
 * left both commits on local `main`, unpushed and unreviewable — the exact
 * outcome CLAUDE.md rule 3 exists to prevent.
 *
 * The gate bought no safety in return. Since #204 the production workflow is
 * `workflow_dispatch` only, so pushing `main` ships nothing and there is no
 * deploy for a prompt to guard; those entries were a leftover from when
 * "pushing main is a production deploy" was still believed, which is the claim
 * tests/rules/pushing-main-does-not-deploy.test.ts holds down in prose.
 */
export const PUSHES_THE_LOOP_MAKES = [
  'git push origin main',
  'git push origin master',
  'git push',
] as const

/** A gate that would stop the loop publishing its work. */
export interface PushBlocker {
  /** Which permission list it came from — `deny` cannot even be granted. */
  list: 'ask' | 'deny'
  /** The entry verbatim, so the warning names something greppable. */
  entry: string
  /** Which of `PUSHES_THE_LOOP_MAKES` it gates. */
  blocks: string
}

export interface BoardPermissionCheck {
  ok: boolean
  /** Board tools this settings file does not pre-approve. */
  missing: string[]
  /** Set when the file itself is the problem rather than its contents. */
  problem?: string
}

/**
 * `permissions.allow`, from JSON-with-comments.
 *
 * Reuses `removeComments` from the settings validator rather than a regex of
 * its own: the entries in these files legitimately contain `//`
 * (`postgresql://`, `Read(//dev/**)`), and a naive comment strip cut them off
 * mid-string and left the file unparseable — which is how the validator's
 * `--fix` once broke the very file it was fixing.
 */
export function allowedToolsIn(source: string): string[] {
  const parsed = JSON.parse(removeComments(source))
  const allow = parsed?.permissions?.allow
  return Array.isArray(allow)
    ? allow.filter((entry: unknown): entry is string => typeof entry === 'string')
    : []
}

/**
 * Does this `Bash(...)` permission entry match `command`?
 *
 * Claude Code's Bash rules are the command with optional globs — `Bash(git *)`,
 * and the prefix form `Bash(git push:*)`, which means the same thing. Anything
 * that is not a `Bash(...)` entry (an `mcp__astrid__*` tool name, a
 * `WebFetch(domain:…)`) cannot gate a shell command and is skipped.
 */
function bashEntryMatches(entry: string, command: string): boolean {
  const inner = entry.match(/^Bash\((.*)\)$/)?.[1]
  if (inner === undefined) return false

  const pattern = inner
    .replace(/:\*$/, '*')
    .replace(/[.*+?^${}()|[\]\\]/g, character => (character === '*' ? '*' : `\\${character}`))
    .replace(/\*/g, '.*')

  return new RegExp(`^${pattern}$`).test(command)
}

/**
 * Every gate in this settings file that would stop the loop pushing (AWTD-978).
 *
 * Reads `ask` AND `deny`: `ask` is what actually bit, but `deny` would bite
 * harder — it cannot be granted even at a terminal.
 *
 * An unparseable file reports `[]` rather than throwing, which is the OPPOSITE
 * of `checkBoardPermissions` above and deliberate. There, "I could not tell"
 * must never read as "nothing missing" — that conflation is the AWTD-975 bug.
 * Here the same file is already reported as a parse failure by that function, so
 * a second copy of the same complaint would only make the real finding harder to
 * see. Claude Code reads no permissions at all out of a broken file, so no entry
 * in it is in force anyway.
 */
export function pushBlockersIn(source: string): PushBlocker[] {
  let permissions: Record<string, unknown>
  try {
    permissions = JSON.parse(removeComments(source))?.permissions ?? {}
  } catch {
    return []
  }

  const blockers: PushBlocker[] = []
  for (const list of ['ask', 'deny'] as const) {
    const entries = permissions[list]
    if (!Array.isArray(entries)) continue

    for (const entry of entries) {
      if (typeof entry !== 'string') continue
      const blocks = PUSHES_THE_LOOP_MAKES.find(push => bashEntryMatches(entry, push))
      if (blocks) blockers.push({ list, entry, blocks })
    }
  }

  return blockers
}

/**
 * Check one settings file's CONTENTS.
 *
 * An unparseable file reports every tool as missing rather than throwing or
 * reading as `{}`. "I could not tell" and "nothing is missing" must not look
 * alike here — that conflation is the bug this whole task is about.
 */
export function checkBoardPermissions(source: string): BoardPermissionCheck {
  let allowed: string[]
  try {
    allowed = allowedToolsIn(source)
  } catch (error) {
    return {
      ok: false,
      missing: [...BOARD_TOOLS_THE_LOOP_NEEDS],
      problem: `could not be parsed as JSON (${(error as Error).message})`,
    }
  }

  const missing = BOARD_TOOLS_THE_LOOP_NEEDS.filter(tool => !allowed.includes(tool))
  return { ok: missing.length === 0, missing }
}

/** Check a settings file on disk. An absent file is a finding, not a pass. */
export function checkBoardPermissionsFile(path: string): BoardPermissionCheck {
  if (!existsSync(path)) {
    return {
      ok: false,
      missing: [...BOARD_TOOLS_THE_LOOP_NEEDS],
      problem: 'does not exist (copy .claude/settings.json.example to it)',
    }
  }
  return checkBoardPermissions(readFileSync(path, 'utf8'))
}

// Main execution — skipped when this module is imported (e.g. by its tests).
const invokedDirectly = process.argv[1]?.includes('check-board-permissions')

if (invokedDirectly) {
  const path = process.argv[2] ?? join(process.cwd(), '.claude/settings.local.json')
  const result = checkBoardPermissionsFile(path)
  const total = BOARD_TOOLS_THE_LOOP_NEEDS.length
  const blockers = existsSync(path) ? pushBlockersIn(readFileSync(path, 'utf8')) : []

  if (result.ok && blockers.length === 0) {
    console.log(`board tools pre-approved (${total}/${total}), nothing gates the push`)
    process.exit(0)
  }

  // Two independent problems, and the remedies differ — so each prints its own
  // rather than the caller guessing which one applies (AWTD-978).
  if (!result.ok) {
    console.log(
      `${path} ${result.problem ?? `is missing ${result.missing.length} of ${total} board tool(s)`}`,
    )
    for (const tool of result.missing) console.log(`  missing: ${tool}`)
    console.log('  → this run falls back to the OAuth scripts and cannot see `attention` (AWTD-963)')
    console.log(`  → fix: copy the mcp__astrid__* entries from .claude/settings.json.example`)
  }

  if (blockers.length > 0) {
    console.log(`${path} gates the push this run ends with:`)
    for (const blocker of blockers) {
      console.log(`  ${blocker.list}: ${blocker.entry}   (matches \`${blocker.blocks}\`)`)
    }
    console.log('  → a scheduled run has no terminal to answer a prompt in, so its finished')
    console.log('    work stays on local `main`, unpushed and unreviewable (CLAUDE.md rule 3)')
    console.log('  → pushing `main` ships nothing: production-deployment.yml is')
    console.log('    workflow_dispatch only, so there is no deploy for this to guard (AWTD-978)')
    console.log('  → fix: delete those entries; `Bash(git *)` in `allow` then covers the push')
  }

  console.log('  (an agent cannot edit either file — .claude/** is a protected path)')
  process.exit(1)
}
