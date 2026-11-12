/**
 * How often the server compares astrid-core's answer with the TypeScript's (AWTD-1591).
 *
 * Every cutover (list permissions, search, repeating, the board) used to run both on every
 * decision. Now, in decide mode, the core answers and the TypeScript runs on 1 decision in N, to
 * keep the agree/disagree totals on /api/health honest, or when the core cannot answer (the
 * fallback). In shadow mode the TypeScript decides anyway, so the core is asked on 1 in N.
 *
 * `ASTRID_CORE_RULES_SAMPLE` sets N for every rule: a whole number of at least 1, where 1 compares
 * every decision (the behaviour before AWTD-1591). Anything else, or unset, is the default.
 */

/** N when `ASTRID_CORE_RULES_SAMPLE` is unset or unreadable. */
export const DEFAULT_SAMPLE_EVERY = 20

/** N from an `ASTRID_CORE_RULES_SAMPLE` value. */
export function sampleEveryFrom(setting: string | undefined = process.env.ASTRID_CORE_RULES_SAMPLE): number {
  const value = Number((setting ?? '').trim())
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_SAMPLE_EVERY
}

/**
 * A sampler for one rule: true on the first call and on every N-th after, false otherwise.
 * Counting rather than random, so a fresh process compares its first decision at once, the rate
 * is exact, and tests are deterministic.
 */
export function createSampler(every: number): () => boolean {
  const n = Number.isInteger(every) && every >= 1 ? every : 1
  let calls = 0
  return () => calls++ % n === 0
}
