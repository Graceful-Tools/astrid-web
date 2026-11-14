/**
 * The pure half of the agent-integration benchmark (AWTD-1551): the target guard and the
 * statistics. scripts/benchmarks/agent-integration.ts does the requests.
 *
 * The benchmark must never generate production traffic or touch the live board, so the guard
 * refuses a production host outright rather than trusting a flag.
 */

/** Hosts the benchmark refuses: production, under any spelling. */
const PRODUCTION_HOSTS = new Set(['astrid.cc', 'www.astrid.cc', 'api.astrid.cc'])

/** Why a target is refused, or null when it may be benchmarked. */
export function benchmarkTargetProblem(origin: string): string | null {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return `not a URL: ${origin}`
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `unsupported protocol ${url.protocol}`
  if (PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) {
    return `${url.hostname} is production; point the benchmark at a preview or a local dev server`
  }
  return null
}

export interface Summary {
  n: number
  p50: number
  p95: number
  mean: number
  stdev: number
  medianBytes: number
  /** Rough token count of the median response, at ~4 bytes per token. */
  approxTokens: number
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

/** p50/p95/mean/stdev over latencies (ms), and the median response size. */
export function summarize(samples: ReadonlyArray<{ ms: number; bytes: number }>): Summary {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b)
  const bytes = samples.map((s) => s.bytes).sort((a, b) => a - b)
  const n = ms.length
  const mean = n ? ms.reduce((a, b) => a + b, 0) / n : 0
  const variance = n > 1 ? ms.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0
  const medianBytes = percentile(bytes, 50)
  return {
    n,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    mean: Math.round(mean * 10) / 10,
    stdev: Math.round(Math.sqrt(variance) * 10) / 10,
    medianBytes,
    approxTokens: Math.ceil(medianBytes / 4),
  }
}

/** One results table, in Markdown, for the results doc. */
export function resultsTable(rows: ReadonlyArray<{ scenario: string; call: string; summary: Summary }>): string {
  const lines = [
    '| Scenario | Call | n | p50 ms | p95 ms | mean ± sd ms | median bytes | ~tokens |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const { scenario, call, summary: s } of rows) {
    lines.push(
      `| ${scenario} | ${call} | ${s.n} | ${s.p50} | ${s.p95} | ${s.mean} ± ${s.stdev} | ${s.medianBytes} | ${s.approxTokens} |`,
    )
  }
  return lines.join('\n')
}
