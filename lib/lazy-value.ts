/**
 * A value computed at most once, and only if asked for (AWTD-1591).
 *
 * The astrid-core hooks are handed the TypeScript rule's answer as one of these rather than as a
 * value: in decide mode the core answers, and the TypeScript is only worth running when the core
 * cannot (the fallback) or when the decision is sampled for comparison. A null or undefined
 * answer is remembered like any other. Imports nothing, so client bundles may use it.
 */
export function lazyValue<T>(compute: () => T): () => T {
  let done = false
  let value: T
  return () => {
    if (!done) {
      value = compute()
      done = true
    }
    return value
  }
}
