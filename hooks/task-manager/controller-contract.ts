/**
 * Controller contract for `useTaskManagerController`.
 *
 * `useTaskManagerController` returns a ~100-key object that gets threaded
 * through TaskManagerView → MainContent → TaskRow / task-detail. Without
 * a named return type, every consumer redeclares which keys it pulls in
 * via inline destructuring — making it easy for refactors to silently
 * drop a handler. With it, TypeScript catches the drift.
 *
 * Usage in consumers:
 *
 *   import type { TaskManagerControllerReturn } from '@/hooks/task-manager/controller-contract'
 *
 *   interface Props {
 *     controller: Pick<TaskManagerControllerReturn,
 *       'tasks' | 'selectedTaskId' | 'handleTaskClick'>
 *   }
 *
 * The contract is derived from the hook's actual return via `ReturnType<>`,
 * so it stays in sync automatically. Consumers can `Pick<>` the slice they
 * need; the cluster-extraction PRs (Stages 15-22) lean on this.
 */

import type { useTaskManagerController } from '@/hooks/useTaskManagerController'

/** The full shape returned by useTaskManagerController. */
export type TaskManagerControllerReturn = ReturnType<typeof useTaskManagerController>
