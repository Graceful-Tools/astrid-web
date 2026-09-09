/**
 * A predeploy failure report may never touch a task it did not file (task 8ef93fb9).
 *
 * On 2026-09-07 AWTD-540 ("eslint 10 blocked upstream") had its description
 * replaced with a byte-identical copy of AWTD-844's predeploy failure report.
 * The real content is gone.
 *
 * No script in this repo can do that — `predeploy-self-healing.ts` only POSTs a
 * create, comments on a match and PATCHes `completed`, and `monitor-vercel-logs.ts`
 * updates only `completed` at its single call site — so the overwrite arrived by
 * some other route. What these tests pin is the mistake that WAS live: the
 * script chose which open task to write to with two substring matches over the
 * whole board, which is how a report reaches somebody else's task.
 */

import { describe, it, expect } from 'vitest'
import {
  PREDEPLOY_REPORT_TAG,
  findReportTaskToUpdate,
  isPredeployReportTask,
} from '../../scripts/lib/predeploy-report-tasks'

/** The real board task whose description was destroyed. */
const AWTD_540 = {
  id: 'awtd-540',
  title: 'eslint 10 blocked upstream: eslint-plugin-react has no eslint 10 support',
  description: '11 dev-only Dependabot advisories trace to one root cause.',
  completed: false,
}

/** A person writing about the same failure, in their own words. */
const HUMAN_TASK = {
  id: 'human',
  title: 'Predeploy Failed: Documentation Links — work out why this keeps happening',
  description: 'It has gone red three times this week.',
  completed: false,
}

/** A report this script filed, in the shape it files them now. */
const OWN_REPORT = {
  id: 'own',
  title: '🔴 Predeploy Failed: Documentation Links, Unit Tests (Vitest)',
  description: `${PREDEPLOY_REPORT_TAG}\n\n## Automated Predeploy Failure Report\n**Generated**: 2026-09-07T04:46:04.500Z`,
  completed: false,
}

/** A report filed before the tag existed. */
const LEGACY_REPORT = {
  id: 'legacy',
  title: '🔴 Predeploy Failed: Build',
  description: '## Automated Predeploy Failure Report\n**Generated**: 2026-09-01T00:00:00.000Z',
  completed: false,
}

describe('which tasks belong to the predeploy report script', () => {
  it('does not claim a task that merely says "Predeploy" in its title', () => {
    // The old filter was `title.includes('Predeploy')`, which this matches.
    expect(isPredeployReportTask(HUMAN_TASK)).toBe(false)
  })

  it('does not claim an unrelated task', () => {
    expect(isPredeployReportTask(AWTD_540)).toBe(false)
  })

  it('claims a report it tagged', () => {
    expect(isPredeployReportTask(OWN_REPORT)).toBe(true)
  })

  it('claims a pre-tag report by its heading and exact title prefix together', () => {
    expect(isPredeployReportTask(LEGACY_REPORT)).toBe(true)
  })

  it('needs both halves for a pre-tag report, not either', () => {
    // The heading pasted into a person's note.
    expect(
      isPredeployReportTask({
        title: 'Why does predeploy keep failing?',
        description: 'They all look like: ## Automated Predeploy Failure Report',
      }),
    ).toBe(false)
    // The title prefix with nothing behind it.
    expect(
      isPredeployReportTask({
        title: '🔴 Predeploy Failed: Build',
        description: 'I retitled this to match the bot so it would stop filing new ones.',
      }),
    ).toBe(false)
  })
})

describe('the rule this replaced', () => {
  /**
   * The predicate the script actually ran, so the regression is pinned as a
   * comparison rather than as a claim about history:
   *
   *   task.title.includes('Predeploy') && task.title.includes(errorSummary.slice(0, 30))
   */
  const oldRule = (task: { title: string }, errorSummary: string) =>
    task.title.includes('Predeploy') && task.title.includes(errorSummary.slice(0, 30))

  it('selected a person’s task, and the new one does not', () => {
    const errorSummary = 'Documentation Links'

    expect(oldRule(HUMAN_TASK, errorSummary)).toBe(true)
    expect(findReportTaskToUpdate([HUMAN_TASK], '🔴 Predeploy Failed: Documentation Links')).toBeNull()
  })
})

describe('which open report a run appends to', () => {
  const title = '🔴 Predeploy Failed: Documentation Links, Unit Tests (Vitest)'

  it('never selects the task whose description was destroyed', () => {
    expect(findReportTaskToUpdate([AWTD_540], title)).toBeNull()
  })

  it('never selects a person’s task about the same failure', () => {
    expect(findReportTaskToUpdate([HUMAN_TASK], title)).toBeNull()
  })

  it('selects its own open report for the same failure', () => {
    expect(findReportTaskToUpdate([AWTD_540, HUMAN_TASK, OWN_REPORT], title)?.id).toBe('own')
  })

  it('files a new task when the failure is a different one', () => {
    // Same script, different checks: appending this run to that report would
    // bury one failure inside another's history.
    expect(findReportTaskToUpdate([OWN_REPORT], '🔴 Predeploy Failed: TypeScript')).toBeNull()
  })

  it('matches the whole title, not a prefix of it', () => {
    // `startsWith` would append a two-check failure to the one-check report.
    expect(findReportTaskToUpdate([OWN_REPORT], '🔴 Predeploy Failed: Documentation Links')).toBeNull()
  })

  it('leaves a closed report alone and files a new one', () => {
    expect(findReportTaskToUpdate([{ ...OWN_REPORT, completed: true }], title)).toBeNull()
  })
})
