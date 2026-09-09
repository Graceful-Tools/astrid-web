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
  'components/task-detail.tsx': 1585,
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
  'services/task.service.ts': 1698,
  'components/task-detail/TaskFieldEditors.tsx': 1078,
  'components/oauth-api-tester.tsx': 973,
  'mcp/mcp-server-oauth.ts': 957,
  'components/oauth-app-manager.tsx': 919,
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
