import {
  reconcileAgentLifecycleAfterTaskMutation,
  reconcileAgentLifecycleBoard,
} from '@/lib/agent-lifecycle'

export function reconcileTaskLifecycleAfterMutation(
  taskId: string,
  options: { completed?: boolean } = {},
) {
  return reconcileAgentLifecycleAfterTaskMutation(taskId, options)
}

export function reconcileBoardLifecycleAfterMutation(boardId: string) {
  return reconcileAgentLifecycleBoard(boardId)
}
