/**
 * Telling a starved vitest worker apart from a failing test (task d036295d).
 *
 * This machine also builds astrid-ios. When it does, load has been measured at
 * 348 on 8 cores, and vitest cannot get its worker processes scheduled:
 *
 *   Error: [vitest-pool]: Failed to start forks worker for test files <path>
 *   Caused by: [vitest-pool-runner]: Timeout waiting for worker to respond
 *
 * Vitest counts a file it could not START as a failing file, so the gate goes
 * red naming files that are fine — three different sets across three runs in
 * one afternoon, every one green in isolation. `vitest.shared.ts` already caps
 * `maxWorkers` at half the cores for this reason; the cap is correct and
 * insufficient, because it bounds OUR workers and cannot bound an Xcode build.
 *
 * The danger in softening any of this is obvious and worth stating: the same
 * afternoon, the gate caught a REAL regression (an agent-hub assertion a new
 * row broke) that was nearly dismissed as more contention noise. So the rule
 * here is deliberately narrow — starvation is only ever recognised when NO
 * test failed. One real failure and this module stands aside.
 */

/**
 * Is this predeploy check the vitest suite?
 *
 * Stated once because two call sites ask it — the stats parser and the
 * starvation branch — and a check that parsed vitest output but skipped the
 * starvation classification would go red on exactly the runs this exists for.
 */
export function isVitestCheck(checkName: string): boolean {
  return checkName.includes('Vitest') || checkName.includes('Unit Tests')
}

/** What a non-zero vitest exit actually was. */
export type VitestFailureKind =
  | { kind: 'tests-failed' }
  | {
      kind: 'starved'
      /** Files vitest never ran, recoverable by re-running just them. */
      unstartedFiles: string[]
      /** Sentence for the console and the auto-filed task. */
      summary: string
    }

/** Counts as parsed from vitest's summary line. */
export interface VitestStats {
  passed: number
  failed: number
  skipped: number
  total: number
}

/**
 * The pool's message names the file it gave up on. Matching the path rather
 * than the whole line because the "Caused by:" detail varies between a worker
 * that timed out and one that was refused outright.
 */
const UNSTARTED_FILE = /Failed to start forks worker for test files\s+(\S+)/g

/** Files vitest reported it could not start, in the order it reported them. */
export function unstartedTestFiles(output: string): string[] {
  const found = [...output.matchAll(UNSTARTED_FILE)].map(match => match[1])
  // A file can be reported by more than one pool message; re-running it twice
  // would be harmless but the report would read as though more went wrong.
  return [...new Set(found)]
}

/**
 * Classify a non-zero vitest exit.
 *
 * Starvation is recognised in exactly two shapes, and only when nothing failed:
 *
 *  1. The pool named files it could not start. Those files can be re-run.
 *  2. Vitest exited non-zero having reported ZERO failures. Observed with six
 *     tests simply missing from the totals and nothing naming a file — there
 *     is nothing to re-run, but a run with no failing test is not a test
 *     failure and must not be reported as one.
 *
 * Anything else — including starvation messages sitting alongside a genuine
 * failure — is a failing suite. `stats` being undefined means vitest printed
 * no summary (killed, crashed), which is likewise not something to excuse.
 */
export function classifyVitestFailure(
  output: string,
  stats: VitestStats | undefined
): VitestFailureKind {
  // No summary means no evidence. A crash must not be laundered into "the
  // machine was busy".
  if (!stats) return { kind: 'tests-failed' }

  // The guard rail. A real regression reported during contention is still a
  // real regression, and must stay red naming itself.
  if (stats.failed > 0) return { kind: 'tests-failed' }

  const unstartedFiles = unstartedTestFiles(output)

  if (unstartedFiles.length > 0) {
    return {
      kind: 'starved',
      unstartedFiles,
      summary:
        `vitest could not start ${unstartedFiles.length} worker(s), and counts a file it ` +
        `could not START as a failing file. This is NOT a test failure — every test that ` +
        `ran, passed (${stats.passed}). The usual cause is another build saturating the ` +
        `machine. Re-running just the unstarted files.`,
    }
  }

  return {
    kind: 'starved',
    unstartedFiles: [],
    summary:
      `vitest exited non-zero while reporting ZERO failing tests (${stats.passed} passed). ` +
      `This is NOT a test failure — no test said it failed, so none should be inferred. ` +
      `Tests are usually missing from the totals entirely, which is what a worker that ` +
      `never started looks like when the pool does not name it. Re-run when the machine ` +
      `is quieter.`,
  }
}
