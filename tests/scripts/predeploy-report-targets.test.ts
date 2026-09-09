/**
 * Task 8ef93fb9, incident A — a predeploy report may only ever touch a task it
 * created.
 *
 * On 2026-09-07 05:56 UTC, AWTD-540 ("eslint 10 blocked upstream") had its
 * description replaced with AWTD-844's predeploy failure report, byte for byte.
 * That task's content was destroyed and had to be reconstructed by hand.
 *
 * The filing named `scripts/predeploy-self-healing.ts` as the prime suspect,
 * and it is NOT the writer — worth recording, because the next person will
 * suspect it too. It POSTs a new task with a description, COMMENTS on a match,
 * and PATCHes only `{ completed: true }`. `monitor-vercel-logs.ts` next door
 * can express a description update, but `updateAstridTask` is only ever called
 * with `{ completed: true }`. Neither one writes a description onto an existing
 * task, so neither could have done this.
 *
 * What IS wrong with the predeploy script is the selector that decides which
 * task the report belongs to:
 *
 *     task.title.includes('Predeploy') && task.title.includes(errorSummary.slice(0, 30))
 *
 * A substring match over every open task on the board. `errorSummary` is a
 * check name — "Build", "TypeScript", "Unit Tests (Vitest)" — so the second
 * condition is close to free, and the first matches anything with the word
 * "Predeploy" in its title, including a human's task ABOUT the predeploy
 * script. Today that only mis-targets a comment. The moment anyone adds a
 * description write to this path, it mis-targets an overwrite, which is the
 * incident.
 *
 * This is the same bug `scripts/lib/deployment-monitor-tasks.ts` was written
 * to fix one file over (task d893debc): "match the marker this script WRITES,
 * never the words a human might type."
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPredeployReportTask, PREDEPLOY_REPORT_TAG } from '@/scripts/lib/predeploy-report-tasks'

const SCRIPT = 'scripts/predeploy-self-healing.ts'
const source = readFileSync(join(process.cwd(), SCRIPT), 'utf8')

/**
 * The script without its comments.
 *
 * The comment explaining why the old selector was wrong necessarily quotes the
 * old selector. Matching raw source would fail on that explanation — punishing
 * the file for documenting the fix.
 */
const code = source
  .split('\n')
  .filter(line => {
    const trimmed = line.trim()
    return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
  })
  .join('\n')

describe('a predeploy report only touches its own tasks (task 8ef93fb9)', () => {
  it('recognises a task it created, by the marker it writes', () => {
    expect(
      isPredeployReportTask({
        title: '🔴 Predeploy Failed: Build',
        description: `${PREDEPLOY_REPORT_TAG}\n\n## Automated Predeploy Failure Report`,
      })
    ).toBe(true)
  })

  it("does NOT claim a human's task that merely says Predeploy", () => {
    // The exact shape that destroyed AWTD-540's neighbour: a real task whose
    // title happens to carry the word.
    expect(
      isPredeployReportTask({
        title: 'Predeploy is slow — cache the type-check',
        description: 'The gate takes 8 minutes and half of it is tsc.',
      })
    ).toBe(false)

    expect(
      isPredeployReportTask({
        title: 'eslint 10 blocked upstream: eslint-plugin-react has no eslint 10 support',
        description: '11 dev-only Dependabot advisories trace to one root.',
      })
    ).toBe(false)
  })

  it('does not claim a task that merely QUOTES a report', () => {
    // A person pasting the report into a task to discuss it must not thereby
    // hand the script write access to their task.
    expect(
      isPredeployReportTask({
        title: 'Why does predeploy keep failing on Build?',
        description: 'It posts "## Automated Predeploy Failure Report" every time.',
      })
    ).toBe(false)
  })

  it('recognises pre-tag reports by title AND heading together, never either alone', () => {
    // Reports created before the tag existed are still ours. Both conditions,
    // for the reason the deployment monitor gives: a title prefix alone was the
    // original bug in a stricter costume.
    expect(
      isPredeployReportTask({
        title: '🔴 Predeploy Failed: TypeScript, Build',
        description: '## Automated Predeploy Failure Report\n\n**Generated**: …',
      })
    ).toBe(true)

    expect(
      isPredeployReportTask({
        title: '🔴 Predeploy Failed: TypeScript',
        description: 'Someone rewrote this description entirely.',
      })
    ).toBe(false)
  })

  it('treats a missing title or description as not ours', () => {
    expect(isPredeployReportTask({})).toBe(false)
    expect(isPredeployReportTask({ title: null, description: null })).toBe(false)
  })
})

describe(`${SCRIPT} cannot overwrite a description (task 8ef93fb9)`, () => {
  it('never sends a description to an existing task', () => {
    // The incident was a description REPLACED on a task the writer did not
    // create. Creating a task with a description is fine — that is a new row.
    // Updating one is the operation that destroys content, and this path has no
    // business doing it: new information goes in a comment.
    const updates = [...code.matchAll(/method:\s*'(PUT|PATCH)'/g)]
    expect(updates.length).toBeGreaterThan(0) // the completion PATCH exists

    for (const match of updates) {
      // Read the body that follows this call and assert it carries no description.
      const body = code.slice(match.index!, match.index! + 400)
      expect(
        body.includes('description'),
        `A ${match[1]} in ${SCRIPT} sends a description. New information belongs ` +
          `in a comment — replacing a description is what destroyed AWTD-540.`
      ).toBe(false)
    }
  })

  it('no longer selects tasks by a bare substring of the title', () => {
    expect(
      code.includes("title.includes('Predeploy')"),
      `${SCRIPT} still matches open tasks on the word "Predeploy". Use ` +
        `isPredeployReportTask from scripts/lib/predeploy-report-tasks.ts.`
    ).toBe(false)
  })

  it('writes the marker it matches on, so the two cannot drift apart', () => {
    expect(source).toContain('PREDEPLOY_REPORT_TAG')
  })
})
