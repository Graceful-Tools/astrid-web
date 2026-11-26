/**
 * The queue answer that carries no work at all: an agent identity nobody has
 * used yet, or a polling-only agent the caller turned Off (AWTD-1563). Split
 * out of lib/agent-queue.ts, which is on the oversized-files ratchet.
 */

import type { AgentQueueResult } from '@/lib/agent-queue'

export function emptyAgentQueue(
  agent: AgentQueueResult['agent'],
  mode: string,
  hint: string,
  runtimeBinding?: AgentQueueResult['runtimeBinding'],
): AgentQueueResult {
  return {
    agent,
    mode,
    empty: true,
    queue: [],
    listInstructions: [],
    held: { notDueCount: 0, notReadyCount: 0, scheduled: [] },
    truncated: false,
    attention: { tasks: [], messages: [], truncated: false, skipped: [] },
    hint,
    runnable: { version: 1, hasWork: false, reasons: [], incomplete: false },
    ...(runtimeBinding ? { runtimeBinding } : {}),
  }
}
