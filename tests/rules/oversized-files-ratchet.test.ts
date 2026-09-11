/**
 * RATCHET — task 9377bc2c.
 *
 * Seven files sit above 800 lines, and the reason to pin them now rather than
 * after splitting them is that the splitting is already under way:
 * `components/task-detail/` holds nine extracted components and is still
 * growing, while `components/task-detail.tsx` itself has not gone down. An
 * extraction that runs alongside continued growth in the original nets to
 * nothing, and nobody notices, because there is no number anywhere that says
 * so.
 *
 * So this is a BUDGET PER FILE, not a ban and not a total. A total would let a
 * 900-line file grow by 200 as long as something else shrank — which is exactly
 * the invisible wash this exists to prevent.
 *
 * Two failures are possible, and they mean opposite things:
 *
 *   - a file grew past its budget → do not raise the number. Take the next
 *     piece out of it. The whole point is that "just a bit more" is what got
 *     these files here.
 *   - a file shrank below its budget → good news, and the only failure in this
 *     file that is. Lower the budget to lock the gain in, or the next slice
 *     silently gives it back.
 *
 * NEW oversized files fail too. Otherwise the problem simply relocates: a
 * 1,600-line hook split into two 900-line hooks is not progress, and without
 * this check it would read as a clean diff.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Above this, a file needs a recorded budget or it is a new offender. */
const THRESHOLD = 800

/**
 * Line counts as of 2026-09-09, the day this ratchet was added.
 *
 * Lower these as extractions land. Raising one is a deliberate act with a
 * reason in the commit message, not a reflex.
 */
const BUDGETS: Record<string, number> = {
  // The seven the task named.
  'hooks/useTaskManagerController.ts': 1661,
  // 1585 → 1591: AWTD-877 made someone else's task open the options sheet on
  // every surface, and this panel is one of the three that owns a sheet. Six
  // lines — the predicate, the import, and two props — with the rule itself in
  // lib/task-leading-control.ts and the confirmation in its own component. The
  // next change to this file should still take something out.
  'components/task-detail.tsx': 1591,
  'lib/ai-orchestrator.ts': 1547,
  'components/TaskManagerView.tsx': 1212,
  'components/TaskManager/MainContent/MainContent.tsx': 1125,
  'lib/cache-manager.ts': 935,
  'lib/astrid-agent-runtime.ts': 835,

  // Six more the threshold found that the filing did not list. Recording them
  // is not endorsing them — it is the difference between seven watched files
  // and thirteen.
  //
  // The one worth reading twice is TaskFieldEditors. It came OUT of
  // task-detail.tsx, and it is 1,078 lines: the extraction relocated the
  // problem rather than solving it, which is precisely the failure the
  // new-file check below exists to catch, arriving here as history instead.
  // 1600 → 1698. Raised deliberately, not reflexively: AWTD-777 added the
  // agent-assignment authority check (the credential vulnerability) and
  // AWTD-856 added enum validation at the write choke point. Both belong in
  // this file precisely BECAUSE five write surfaces delegate through it — a
  // check anywhere else would cover one surface and look complete. The next
  // change to this file should take something out.
  // 1698 → 1638: AWTD-887 needed the assignee rule to distinguish a person from
  // an agent, which would have grown this file by thirty lines. The whole
  // decision went to services/assignee-authorization.ts instead, taking the
  // forty lines that were already here with it.
  // 1638 → 1626: AWTD-891 had to make the CREATE path apply the same assignee
  // rules, which is more code here, not less. The gate went to
  // assignee-authorization.ts as `authorizeNewTaskAssignee` and took create's
  // hand-rolled people-check and its existence lookup with it.
  'services/task.service.ts': 1626,
  'components/task-detail/TaskFieldEditors.tsx': 1078,
  'components/oauth-api-tester.tsx': 973,
  // 957 → 688: AWTD-871 needed to add a `requireReady` parameter to the
  // get_agent_queue schema, which pushed this over. The 280-line
  // OAUTH_MCP_TOOLS array moved to mcp/tool-definitions.ts instead of the
  // number moving — the tool schemas are pure declaration and the half that
  // gets edited most, so the next parameter now costs this budget nothing.
  // 688 → 702: AWTD-878 taught this server to sign comments as the agent
  // instead of as the OAuth client's owner. The identity itself lives in
  // mcp/agent-identity.ts — what landed here is the field, the observe() call
  // on the queue response, and the one spread in the comment body.
  // 702 → 609: the MCP OAuth fixes (tasks 11f578e0, 1ae5501e) added a
  // process-level token cache here. Rather than raise the number, the
  // transport moved out: mcp/oauth-api-client.ts holds OAuthAPIClient and
  // mcp/hosted-token-cache.ts the cache, leaving this file the MCP protocol
  // surface. Locking the gain in.
  'mcp/mcp-server-oauth.ts': 609,
  // 919 → 901: task 10f26dc6 added a card explaining when a manual client is
  // needed at all. Both that card and GRANT_TYPE_OPTIONS — the same question,
  // asked as a form field — moved to components/oauth-client-guide.tsx.
  'components/oauth-app-manager.tsx': 901,
  // 801 → 791: AWTD-808 moved this off its own Resend client onto the shared
  // transport. Locking the gain in, which is what the slack check is for.
  'lib/email-reminder-service.ts': 791,
}

/** Product code. Tests and scripts are long for their own reasons. */
const SCANNED = ['app', 'components', 'hooks', 'lib', 'services', 'mcp']

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

function lineCount(file: string): number {
  return readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1
}

const measured = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir))).map(file =>
  relative(ROOT, file)
)

describe('oversized files do not grow (task 9377bc2c)', () => {
  it('every budgeted file stays at or under its recorded size', () => {
    const grown = Object.entries(BUDGETS)
      .map(([file, budget]) => ({ file, budget, actual: lineCount(file) }))
      .filter(entry => entry.actual > entry.budget)

    expect(
      grown,
      `These grew past their recorded size:\n` +
        grown.map(g => `  ${g.file}: ${g.actual} > ${g.budget}`).join('\n') +
        `\n\nTake the next piece out of the file rather than raising the number here. ` +
        `"Just a bit more" each time is how they reached these sizes.`
    ).toEqual([])
  })

  it('no budget is left slack after an extraction lands', () => {
    // A budget above the real number has stopped ratcheting: it silently
    // permits giving back exactly as much as was just taken out.
    const slack = Object.entries(BUDGETS)
      .map(([file, budget]) => ({ file, budget, actual: lineCount(file) }))
      .filter(entry => entry.actual < entry.budget)

    expect(
      slack,
      `Good news — these shrank. Lower their budgets in this file to lock it in:\n` +
        slack.map(s => `  ${s.file}: ${s.budget} → ${s.actual}`).join('\n')
    ).toEqual([])
  })

  it('no NEW file crosses the threshold, so the problem cannot just relocate', () => {
    // Splitting a 1,600-line hook into two 900-line hooks is not progress, and
    // without this it would read as a clean diff.
    const newOffenders = measured
      .filter(file => !(file in BUDGETS))
      .map(file => ({ file, lines: lineCount(file) }))
      .filter(entry => entry.lines > THRESHOLD)

    expect(
      newOffenders,
      `New files over ${THRESHOLD} lines:\n` +
        newOffenders.map(o => `  ${o.file}: ${o.lines}`).join('\n') +
        `\n\nSplit it, or add it to BUDGETS with a reason if it is genuinely one thing.`
    ).toEqual([])
  })

  it('every budgeted file still exists, so a rename cannot silently drop the budget', () => {
    const missing = Object.keys(BUDGETS).filter(file => !measured.includes(file))

    expect(
      missing,
      `Budgeted files that no longer exist:\n` +
        missing.map(f => `  ${f}`).join('\n') +
        `\n\nIf one was renamed, move its budget to the new path — a deleted key ` +
        `is an unwatched file, not a solved one.`
    ).toEqual([])
  })
})
