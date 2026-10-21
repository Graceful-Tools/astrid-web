/**
 * RULE — AWTD-1311: a script that writes on the board says who is writing.
 *
 * This bug has now been fixed three times in three places and come back twice.
 * AWTD-878 did the MCP server, AWTD-970 did the sweep, AWTD-974 did the status
 * change, and on 2026-10-21 Jon read two of his own agent's comments on
 * [AWTD-1305](https://astrid.cc/t/AWTD-1305) under his own name and face:
 * *"This comment is coming from the current user. This is a bug. It should come
 * from Claude."*
 *
 * It keeps coming back because the failure is INVISIBLE from the writing side.
 * Client-credentials auth resolves `auth.userId` to the client's owner, so a
 * write that simply omits `aiAgentId` succeeds, returns 200, and is wrong. There
 * is nothing to notice. Every previous fix patched the one script that had been
 * caught; the next script written by copy-and-paste from a neighbour brought it
 * straight back — `add-oauth-comment.ts` is `add-task-comment.ts` with exactly
 * the attribution step missing.
 *
 * So this is a check rather than another paragraph asking the next author to
 * remember. A script that POSTs a task comment or PUTs a task either resolves
 * its author through `lib/agent-author.ts`, or it is named below with the reason
 * its writes are a person's.
 *
 * WHY IT IS NOT COSMETIC, in two directions:
 *   - `fanOutComment` (lib/notifications.ts) removes the ACTOR from the people
 *     it notifies. Record Jon as the actor and the suppression protects the
 *     wrong person — he is not told about comments addressed to him.
 *   - The attention inbox (AWTD-963) asks "is the newest comment from a human?".
 *     Every comment the loop wrote under Jon's name answers yes, so the loop
 *     wakes itself up to answer itself.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCANNED = 'scripts'

/**
 * Scripts whose writes are genuinely a PERSON's, with the reason.
 *
 * A one-off run by hand, from a terminal, by whoever is holding the keyboard:
 * their name on the activity line is correct and an agent's would be a lie. The
 * test exists to make adding a line here a decision rather than an oversight.
 */
const HUMAN_AUTHORED: Record<string, string> = {
  'scripts/assign-to-agent.ts': 'run by hand to hand a task to an agent — the mover is the person',
  'scripts/move-task-to-list.ts': 'run by hand to move a task between boards',
  'scripts/restart-ai-tasks.ts': 'one-off operational repair, run by a person',
  'scripts/cleanup-google-backfill-open-tasks.ts': 'one-off data cleanup, run by a person',
  'scripts/mark-shipped-tasks-complete.ts': 'one-off backfill, run by a person once',
}

/**
 * A write to a task or its comments, matched as ONE statement.
 *
 * Matching the URL and the method independently over the whole file does not
 * work: almost every script here POSTs to `/api/v1/oauth/token` and GETs a task,
 * so a read-only reporter like `analyze-task.ts` looked exactly like a writer.
 * The URL and the `method` have to belong to the same `fetch`, hence the window.
 */
const TASK_URL = /\/api\/v1\/tasks\/[^`'"]*/g
const COMMENTS_URL = /\/comments(\?|[`'"])/g
const WRITE_METHOD = /method: ?['"](POST|PUT|PATCH)['"]/
/** How far past the URL the `method` can sit and still be the same call. */
const SAME_CALL = 400

/**
 * Resolving the author through the shared rule, or through a collaborator that
 * already does. `sweep-api.ts` takes the resolved id as a constructor argument,
 * so its callers are the ones that have to resolve it.
 */
const RESOLVES_ITS_AUTHOR = /agent-author|aiAgentId|new SweepApi\(|\.\.\.\(agent \? \{ agent \} : \{\}\)/

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'archive' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
  }
  return out
}

/** Every script that writes a comment or a task update through the v1 API. */
function boardWriters(): string[] {
  const found: string[] = []
  for (const file of sourceFiles(join(ROOT, SCANNED))) {
    if (!writesOnTheBoard(readFileSync(file, 'utf8'))) continue
    found.push(relative(ROOT, file))
  }
  return found.sort()
}

/** Does any task/comment URL in `source` sit on a WRITING fetch? */
function writesOnTheBoard(source: string): boolean {
  for (const pattern of [TASK_URL, COMMENTS_URL]) {
    for (const match of source.matchAll(pattern)) {
      const from = (match.index ?? 0) + match[0].length
      if (WRITE_METHOD.test(source.slice(from, from + SAME_CALL))) return true
    }
  }
  return false
}

describe('a script that writes on the board names its author (AWTD-1311)', () => {
  it('the scan is not vacuously green — it finds the writers it is meant to police', () => {
    const writers = boardWriters()

    // If a rename ever empties this list, the test would pass by finding
    // nothing. These three are the ones the bug was reported against.
    expect(writers).toContain('scripts/add-task-comment.ts')
    expect(writers).toContain('scripts/assign-task.ts')
    expect(writers).toContain('scripts/set-task-status.ts')
    expect(writers.length).toBeGreaterThan(8)
  })

  it('AWTD-1311: every board writer resolves its author, or says why it is a person', () => {
    const unsigned = boardWriters().filter(path => {
      if (path in HUMAN_AUTHORED) return false
      return !RESOLVES_ITS_AUTHOR.test(readFileSync(join(ROOT, path), 'utf8'))
    })

    expect(
      unsigned,
      'These write on the board with no author, so they write as the OAuth client owner. ' +
        'Resolve the mailbox with resolveAgentAuthorId from lib/agent-author.ts, or add the ' +
        'file to HUMAN_AUTHORED above with the reason its writes are a person\'s.',
    ).toEqual([])
  })

  it('AWTD-1311: the exemption list has no stale entries', () => {
    // An entry for a file that no longer writes is an exemption nobody can see
    // the shape of, and the next reader trusts it.
    const writers = new Set(boardWriters())
    const stale = Object.keys(HUMAN_AUTHORED).filter(path => !writers.has(path))

    expect(stale, 'listed as human-authored but no longer writes on the board').toEqual([])
  })

  it('AWTD-1311: CLAUDE_AGENT_ID is never read outside the one mailbox that owns it', () => {
    // `.env.local` sets CLAUDE_AGENT_ID on every machine that runs the Claude
    // loop, so a script reading it directly signs a COPILOT run as Claude —
    // which is the same bug with a different wrong name on it. The only place
    // that may read it is lib/agent-author.ts, which gates it on the mailbox.
    const offenders = sourceFiles(join(ROOT, SCANNED))
      .concat(sourceFiles(join(ROOT, 'mcp')))
      .map(file => relative(ROOT, file))
      // `process.env.` / `env.`, so the prose explaining the rule does not trip it.
      .filter(path => path !== 'lib/agent-author.ts')
      .filter(path => /\benv\.CLAUDE_AGENT_ID\b/.test(readFileSync(join(ROOT, path), 'utf8')))

    expect(
      offenders,
      'read the mailbox from lib/agent-author.ts instead — it honours CLAUDE_AGENT_ID ' +
        'for the claude mailbox only',
    ).toEqual([])
  })
})
