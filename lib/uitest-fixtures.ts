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
export const UITEST_ACCOUNT_EMAIL = 'uitest@astrid.cc'

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
