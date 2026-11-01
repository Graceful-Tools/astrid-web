/**
 * Per-API-key rolling token window for the Claude tool loop (AWTD-1460).
 *
 * The one live part of the retired lib/workflow-queue.ts: lib/ai/clients/claude.ts
 * records each response's input tokens here and, before the next iteration,
 * waits out the window when a key is near its 30k-tokens-per-minute limit.
 *
 * In memory ON PURPOSE. It paces the iterations of one tool loop, which run in
 * one process; Anthropic's own 429 is the cross-instance limit. Nothing here
 * is work that must survive the process — that is what lib/jobs/ is for.
 */

const WINDOW_MS = 60_000

const windows = new Map<string, Array<{ at: number; tokens: number }>>()

/** Tokens recorded for this key in the last 60 seconds (an entry exactly 60 s old has left). */
export function tokensUsedInWindow(userId: string, now: number = Date.now()): number {
  const entries = (windows.get(userId) ?? []).filter(e => e.at > now - WINDOW_MS)
  if (entries.length === 0) windows.delete(userId)
  else windows.set(userId, entries)
  return entries.reduce((sum, e) => sum + e.tokens, 0)
}

export function recordTokens(userId: string, tokens: number, now: number = Date.now()): void {
  const entries = windows.get(userId) ?? []
  entries.push({ at: now, tokens })
  windows.set(userId, entries)
}

/** Tests only. */
export function resetTokenWindows(): void {
  windows.clear()
}
