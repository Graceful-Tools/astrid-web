/**
 * The order of the fields under a task's title, in LIST mode.
 *
 * Jon (task 4dd640d9, web half of astrid-ios c8a1ff51): *"Order (under task
 * title): Who, Date, Priority, Lists. For Priority use '!!!' as icon not a
 * flag. Implement same order on all interfaces for list mode (iOS, Mac, web —
 * board details, mobile etc)."*
 *
 * This is a CROSS-PLATFORM contract, and it is stated once per platform on
 * purpose. iOS and Mac state it in `Astrid App/Core/Layout/
 * TaskDetailFieldOrder.swift`:
 *
 *     static let listMode: [TaskDetailField] = [.assignee, .when, .priority, .lists]
 *
 * and the Mac derives its rows from that rather than restating them. Web is the
 * third copy, so it gets the same treatment: the sequence lives here, and the
 * JSX that renders it is pinned against this array by a test.
 *
 * Why bother, for four strings: before this task, iOS and Mac each had Priority
 * FIRST and Who second — the same wrong order, written out twice. Restating an
 * order in every renderer is precisely how it drifts.
 *
 * PROJECT MODE IS DELIBERATELY ABSENT. There, priority and assignee are not
 * rows at all — they live behind the leading control, which opens the options
 * sheet — so there is no order to match. See components/task-leading-control.tsx.
 */

export type TaskDetailField = 'assignee' | 'when' | 'priority' | 'lists'

/** Who, Date, Priority, Lists. */
export const TASK_DETAIL_LIST_MODE_ORDER: readonly TaskDetailField[] = [
  'assignee',
  'when',
  'priority',
  'lists',
] as const
