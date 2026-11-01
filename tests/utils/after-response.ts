/**
 * Hold work deferred with runAfterResponse (lib/background.ts) and run it on
 * demand, so a test can assert on what happens after a response without
 * racing it (AWTD-1462).
 *
 *   vi.mock('@/lib/background', async () => (await import('../utils/after-response')).backgroundMock)
 *   …
 *   await flushAfterResponse()
 *
 * Without a Job table in the test's prisma mock, enqueueJob falls back to
 * running the handler after the response, which this flush also covers. A
 * deferred failure is swallowed, as runAfterResponse swallows it.
 */

const pending: Array<() => Promise<unknown>> = []

export const backgroundMock = {
  runAfterResponse: (_label: string, work: () => Promise<unknown>) => {
    pending.push(work)
  },
}

/** Run everything deferred so far, and anything that work defers in turn. */
export async function flushAfterResponse(): Promise<void> {
  while (pending.length > 0) {
    const work = pending.shift()!
    try {
      await work()
    } catch {
      // runAfterResponse logs and swallows; so does this.
    }
  }
}

/** Drop held work, for a beforeEach. */
export function discardAfterResponse(): void {
  pending.length = 0
}
