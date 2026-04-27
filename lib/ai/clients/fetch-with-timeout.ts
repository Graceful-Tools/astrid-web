/**
 * fetch wrapper that aborts after timeoutMs and translates AbortError into a
 * descriptive timeout error. Used by all AI provider clients.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  providerLabel: string
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`${providerLabel} API request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export const AI_REQUEST_TIMEOUT_MS = 60_000
