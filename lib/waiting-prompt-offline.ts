/**
 * What the task controller uses when lib/waiting-prompt cannot be loaded — offline, its chunk is
 * not fetchable (AWTD-1417's offline round trip). The edit is sent as asked: the prompt cannot be
 * drawn without the network anyway, and the server's rules still apply when the edit syncs.
 */
import type * as WaitingPrompt from '@/lib/waiting-prompt'

type Offline = Pick<typeof WaitingPrompt, 'sendWithWaitingPrompt' | 'isWaitingNeedsCondition' | 'waitingFieldsForCreate'>

export const WAITING_PROMPT_OFFLINE: Offline = {
  sendWithWaitingPrompt: async (_original, requested, send) => send(requested, {}),
  isWaitingNeedsCondition: () => false,
  waitingFieldsForCreate: async () => undefined,
}
