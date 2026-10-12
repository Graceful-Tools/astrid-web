/**
 * What the iOS UI-test account contains, and the rule that keeps the seeder off real accounts.
 *
 * WHY THIS EXISTS. The suite was signed in to `uitest@astrid.cc` and still skipped most of its
 * tests, because the account was EMPTY: one list, no tasks. Every data-driven test took its
 * "nothing to work with" path — "No tasks found", "No tasks found in list", "No lists found" —
 * and `xcodebuild` exited 0. Signing in was necessary and not sufficient (iOS task 44a9cea5).
 *
 * WHY IT RESETS RATHER THAN TOP UP. The tests mutate: they complete tasks, duplicate them, and
 * create new ones. Left alone the account drifts, and a suite whose fixtures depend on what the
 * last run happened to leave behind fails in ways nobody can reproduce. Every run starts from
 * the same state.
 *
 * WHY THE GUARD IS THE IMPORTANT PART. This module's job is to DELETE every task on an account.
 * Pointed at the wrong account that is not a test fixture, it is data loss. So the email is
 * checked against one literal, and the check is not a parameter — there is no argument a caller
 * can pass to make it wipe something else.
 */

/** The only account this seeder may ever touch. */
export const UITEST_ACCOUNT_EMAIL = `uitest@${BRAND.domain}`

/** The list the suite works in. */
export const UITEST_LIST_NAME = 'UI Test List'

export interface UITestFixtureTask {
  title: string
  /** 1 = low … 4 = highest, matching the app's Priority raw values. */
  priority: number
  completed: boolean
}

/**
 * The fixture set, chosen from what the tests actually reach for:
 *
 *  - several incomplete tasks, because the suite taps "the first cell" and then completes,
 *    duplicates or opens it — one task means the second test in a file finds an empty list;
 *  - a mix of priorities, so the priority tests have something to change FROM;
 *  - one already-complete task, so anything filtering completed state has both sides.
 *
 * Titles are stable and obviously synthetic: if one ever shows up on a real board, the seeder
 * pointed somewhere it should not have, and that must be recognisable at a glance.
 */
export const UITEST_FIXTURE_TASKS: readonly UITestFixtureTask[] = [
  { title: 'UITEST Fixture — open task 1', priority: 2, completed: false },
  { title: 'UITEST Fixture — open task 2', priority: 3, completed: false },
  { title: 'UITEST Fixture — open task 3', priority: 1, completed: false },
  { title: 'UITEST Fixture — high priority', priority: 4, completed: false },
  { title: 'UITEST Fixture — already done', priority: 1, completed: true },
]

/**
 * Throws unless the account is the dedicated test one.
 *
 * Deliberately strict: no domain matching, no "starts with uitest", no override flag. A seeder
 * that empties an account should be impossible to aim, not merely discouraged.
 */
export function assertUITestAccount(email: string | null | undefined): void {
  if (email !== UITEST_ACCOUNT_EMAIL) {
    throw new Error(
      `Refusing to seed fixtures into "${email ?? '(none)'}". ` +
        `This wipes every task on the account and may only ever run against ${UITEST_ACCOUNT_EMAIL}.`
    )
  }
}

export interface FixturePlan {
  /** Task ids to delete — everything currently on the account. */
  delete: string[]
  /** Fixtures to create afterwards. */
  create: readonly UITestFixtureTask[]
}

/**
 * Full reset: remove what is there, put the fixtures back.
 *
 * Not a diff. A diff would preserve whatever a half-finished test run left behind, which is
 * precisely the state that makes a failure unreproducible.
 */
export function planFixtureReset(existingTaskIds: readonly string[]): FixturePlan {
  return { delete: [...existingTaskIds], create: UITEST_FIXTURE_TASKS }
}

/**
 * Which tasks the reset deletes — the SQL, stated here so it can be tested
 * (AWTD-1235).
 *
 * **The bug this fixes.** It used to be an INNER JOIN through
 * `_TaskToTaskList` to a list the account owns, so it only ever saw tasks that
 * were ON a list. The suite — and the monkey, which runs first in the same job
 * — quick-adds from My Tasks, and a quick-add from there creates a task on NO
 * LIST. Those have no join row, the reset never saw them, and they accumulated
 * every run. Measured against production on 2026-10-12, read-only: the old
 * query selected **5** tasks and the new one selects **773**, 768 of them
 * list-less tasks the account had created. The three fixtures were still reset
 * faithfully, and still landed so far down a lazy list that they never entered
 * the accessibility tree — so iOS CI failed with "no fixture task is visible on
 * My Tasks", which reads like a missing fixture rather than a reset that was
 * quietly half-doing its job.
 *
 * **Why `creatorId` and not `assigneeId`.** The account creates these tasks, so
 * `creatorId` is what identifies its own leftovers wherever they ended up —
 * list-less, or added to a public list someone else owns. `assigneeId` would
 * also match a task **someone else created and assigned to the account**, which
 * is not the suite's to delete. A reset that destroys another person's work
 * because they shared it with a test account is a far worse bug than this one.
 *
 * **LEFT JOIN and DISTINCT are both load-bearing.** An inner join cannot return
 * a row with no join partner, which is precisely the row being hunted; without
 * DISTINCT a task on two of the account's lists comes back twice.
 */
export const FIXTURE_RESET_TASK_QUERY = `SELECT DISTINCT t.id FROM "Task" t
       LEFT JOIN "_TaskToTaskList" m ON m."A" = t.id
       LEFT JOIN "TaskList" l ON l.id = m."B"
      WHERE l."ownerId" = $1 OR t."creatorId" = $1`
import { BRAND } from '@/lib/brand/config'
