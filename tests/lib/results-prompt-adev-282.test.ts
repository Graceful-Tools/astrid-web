/**
 * ADEV-282: a move into Pending results refused with 422 RESULTS_NEEDS_CONDITION opens the picker; once
 * a link exists the edit is sent again, and cancelling sends nothing more.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { needsPromptAnswer, sendWithWaitingPrompt } from '@/lib/waiting-prompt'
import { subscribeResultsPrompt } from '@/lib/results-prompt'

const refusal = { status: 422, detail: { code: 'RESULTS_NEEDS_CONDITION' } }
const task = { id: 't1', completed: false, statusRole: 'results' }
const original = { id: 't1', completed: false, statusRole: 'doing' }

let unsubscribe: (() => void) | null = null
afterEach(() => unsubscribe?.())

describe('RESULTS_NEEDS_CONDITION prompt (ADEV-282)', () => {
  it('asks, then sends the edit again once the picker linked something', async () => {
    unsubscribe = subscribeResultsPrompt(request => request?.resolve(true))
    const send = vi.fn().mockRejectedValueOnce(refusal).mockResolvedValueOnce(undefined)
    await sendWithWaitingPrompt(original, task, send)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('sends nothing more when the picker is cancelled', async () => {
    unsubscribe = subscribeResultsPrompt(request => request?.resolve(false))
    const send = vi.fn().mockRejectedValue(refusal)
    await sendWithWaitingPrompt(original, task, send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('treats the refusal as answered by a prompt, so no error toast', () => {
    expect(needsPromptAnswer(refusal, {})).toBe(true)
    expect(needsPromptAnswer(new Error('boom'), {})).toBe(false)
  })
})
