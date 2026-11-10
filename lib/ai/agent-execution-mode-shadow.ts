import { isModeLockedToPolling, readAgentSettings, resolveAgentExecutionMode, type AgentExecutionMode } from '@/lib/ai/agent-execution-mode'
import { runAfterResponse } from '@/lib/background'
import { agentExecutionModeShadowEnabled } from '@/lib/env'
import { createLogger } from '@/lib/logger'
import { hashToken } from '@/lib/oauth/oauth-token-manager'

const log = createLogger('ai.agent-execution-mode-shadow')
const SAMPLE_RATE = 0.01
const OBSERVATION_TIMEOUT_MS = 250

export interface AgentExecutionModeShadowInput {
  userId: string
  mailbox: string
  mode: AgentExecutionMode
}

function reportFailure(mailbox: string): void {
  try {
    log.warn({ mailbox }, 'agent execution mode shadow observation failed')
  } catch {
    // Even a broken telemetry transport must not interrupt the queue.
  }
}

/**
 * AWTD-1554: observation only; the existing getter still decides queue mode.
 * Default off: zero extra queries. When enabled, 1% of polling-only requests
 * incur one extra primary-key caller-settings read, deferred after the response.
 * The 250ms timeout bounds observation, not cancellation of the database query.
 * No settings blob is logged, cached, or passed through authentication.
 */
export function observeAgentExecutionMode({
  userId,
  mailbox,
  mode,
}: AgentExecutionModeShadowInput): void {
  try {
    if (!agentExecutionModeShadowEnabled() || !isModeLockedToPolling(mailbox) || Math.random() >= SAMPLE_RATE) return

    runAfterResponse('agent execution mode shadow', async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const settings = await Promise.race([
          readAgentSettings(userId, () => { throw new Error('shadow settings unavailable') }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('shadow observation timed out')), OBSERVATION_TIMEOUT_MS)
          }),
        ])
        const storedAwareMode = resolveAgentExecutionMode({ mailbox, storedModes: settings.modes })
        if (storedAwareMode === mode) return

        log.info(
          { userIdHash: hashToken(`agent-execution-mode-shadow:${userId}`), mailbox },
          'agent execution mode shadow mismatch',
        )
      } catch {
        reportFailure(mailbox)
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    })
  } catch {
    reportFailure(mailbox)
  }
}
