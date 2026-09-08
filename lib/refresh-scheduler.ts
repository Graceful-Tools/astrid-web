/**
 * One coalescing scheduler for "something says the data might be stale"
 * (task ed1d85ba).
 *
 * useTaskListState used to arm three independent paths to loadData: a
 * visibilitychange handler and a focus handler sharing a 60s throttle, and an
 * SSE-reconnect handler on its own 2s debounce with no throttle at all. None of
 * them knew about the others, so the ordinary sequence — the tab comes back,
 * the browser had killed the SSE stream in the background, it reconnects —
 * cost two full loadData runs about two seconds apart, and loadData is four
 * network round trips.
 *
 * The scheduler holds three properties that the separate handlers could not:
 *
 * - **Coalescing.** Every request inside the debounce window collapses into one
 *   run, whatever asked for it.
 * - **A per-reason minimum interval.** The tab-focus triggers keep their 60s
 *   throttle; an SSE reconnect keeps a short one, because it exists to catch up
 *   on events missed while the stream was down and making it wait out the tab
 *   throttle would sit on them. A run serves every pending reason, so the
 *   urgent one pulls the throttled one along rather than being delayed by it.
 * - **No overlap.** A second run never starts while one is in flight; the
 *   request is re-armed when the first finishes.
 *
 * One deliberate difference from the handlers it replaces: a request inside its
 * minimum interval is DEFERRED to the end of that interval, where the old code
 * dropped it outright. Refreshing late beats not refreshing, and it is still
 * one call.
 */

export interface RefreshRequestOptions {
  /**
   * How long since the last completed run this reason is willing to wait for.
   * Defaults to 0 — run at the end of the debounce window.
   */
  minIntervalMs?: number
}

export interface RefreshSchedulerOptions {
  /** Window over which simultaneous requests collapse into one run. */
  debounceMs: number
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface RefreshScheduler {
  /** Ask for a refresh. Safe to call as often as events arrive. */
  request(reason: string, options?: RefreshRequestOptions): void
  /**
   * Record that a refresh happened by some other route — the mount effect, a
   * manual pull-to-refresh — so the minimum intervals are measured from it too.
   */
  notifyRan(): void
  /** Drop anything pending. Call from effect teardown. */
  cancel(): void
}

export function createRefreshScheduler(
  run: (reasons: string[]) => void | Promise<void>,
  { debounceMs, now = () => Date.now() }: RefreshSchedulerOptions,
): RefreshScheduler {
  /**
   * reason -> when it was asked for, and the minimum interval it asked for.
   *
   * The request time is stored rather than folded into a deadline up front
   * because `lastRunAt` can move after the request — a manual refresh, or a run
   * finishing — and the moment a reason becomes due has to be recomputed
   * against the new value rather than fixed at request time.
   */
  const pending = new Map<string, { requestedAt: number; minIntervalMs: number }>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let timerFiresAt = 0
  // "Never" — a scheduler that has not run yet holds nothing back, so the very
  // first request is served at the end of the debounce window whatever minimum
  // interval it asked for. A caller that loads on mount by some other route
  // reports it with notifyRan() so the intervals are measured from that.
  let lastRunAt = Number.NEGATIVE_INFINITY
  let inFlight = false

  /**
   * The earliest moment any pending reason is willing to run. Each reason may
   * run once both the debounce window has passed and its own minimum interval
   * since the last run has elapsed; the run itself serves all of them.
   */
  function earliestAllowed(): number {
    let earliest = Number.POSITIVE_INFINITY
    for (const { requestedAt, minIntervalMs } of pending.values()) {
      earliest = Math.min(earliest, Math.max(requestedAt + debounceMs, lastRunAt + minIntervalMs))
    }
    return earliest
  }

  function arm() {
    if (pending.size === 0) return

    const target = earliestAllowed()
    // An existing timer that already fires no later is left alone: re-arming it
    // on every event is how a debounce turns into a permanently deferred run.
    if (timer !== null) {
      if (target >= timerFiresAt) return
      clearTimeout(timer)
    }

    timerFiresAt = target
    timer = setTimeout(fire, Math.max(0, target - now()))
  }

  function fire() {
    timer = null
    // Leave the reasons pending; the in-flight run re-arms when it finishes.
    if (inFlight) return
    if (pending.size === 0) return

    // The due time is re-derived rather than trusted: a run that completed, or
    // a notifyRan, may have moved `lastRunAt` forward since this timer was set,
    // and firing anyway would break the very minimum interval being enforced.
    if (earliestAllowed() > now()) {
      arm()
      return
    }

    execute()
  }

  function execute() {
    const reasons = Array.from(pending.keys())
    pending.clear()
    inFlight = true
    lastRunAt = now()

    Promise.resolve()
      .then(() => run(reasons))
      // The caller owns reporting its own failure; a rejection here must not
      // leave the scheduler wedged in flight forever.
      .catch(() => undefined)
      .then(() => {
        inFlight = false
        lastRunAt = now()
        arm()
      })
  }

  return {
    request(reason, options) {
      const minIntervalMs = options?.minIntervalMs ?? 0
      const existing = pending.get(reason)
      // Keep the earliest request and the most urgent interval asked for under
      // this reason: repeating a request must never push its run further out.
      pending.set(reason, existing === undefined
        ? { requestedAt: now(), minIntervalMs }
        : {
            requestedAt: Math.min(existing.requestedAt, now()),
            minIntervalMs: Math.min(existing.minIntervalMs, minIntervalMs),
          })
      arm()
    },

    notifyRan() {
      lastRunAt = now()
      // Anything already scheduled is now measured against a later run, so the
      // timer has to be recomputed — otherwise a refresh by another route left
      // a pending run to fire inside the interval it was supposed to respect.
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        arm()
      }
    },

    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending.clear()
    },
  }
}
