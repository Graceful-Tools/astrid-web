/**
 * AWTD-1460: the per-key token window that lib/ai/clients/claude.ts paces its
 * tool loop by, moved out of the retired WorkflowQueue. Pins what AWTD-1342
 * pinned for it there.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { recordTokens, resetTokenWindows, tokensUsedInWindow } from '@/lib/ai/token-window'

const T = 1_000_000

beforeEach(() => resetTokenWindows())

describe('token window (AWTD-1460, from AWTD-1342)', () => {
  it('is a rolling 60 seconds: an entry exactly 60s old has left the window', () => {
    recordTokens('alice', 1000, T)
    recordTokens('alice', 500, T + 30_000)

    expect(tokensUsedInWindow('alice', T + 59_999)).toBe(1500)
    expect(tokensUsedInWindow('alice', T + 60_000)).toBe(500)
    expect(tokensUsedInWindow('alice', T + 90_000)).toBe(0)
  })

  it('is per key: one user’s usage never spends another’s budget', () => {
    recordTokens('alice', 29_000, T)
    expect(tokensUsedInWindow('bob', T)).toBe(0)
    expect(tokensUsedInWindow('alice', T)).toBe(29_000)
  })
})
