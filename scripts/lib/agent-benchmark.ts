/**
 * The pure half of the agent-integration benchmark (AWTD-1551): the target guard and the
 * statistics. scripts/benchmarks/agent-integration.ts does the requests.
 *
 * The benchmark must never generate production traffic or touch the live board, so the guard
 * refuses a production host outright rather than trusting a flag.
 */

import { BRAND } from '@/lib/brand/config'

/** Hosts the benchmark refuses: this deployment's production domain, under any spelling. */
function productionHosts(domain: string = BRAND.domain): Set<string> {
  const bare = domain.toLowerCase().replace(/^www\./, '')
  return new Set([bare, `www.${bare}`, `api.${bare}`])
}

/** Why a target is refused, or null when it may be benchmarked. */
export function benchmarkTargetProblem(origin: string, domain: string = BRAND.domain): string | null {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return `not a URL: ${origin}`
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `unsupported protocol ${url.protocol}`
  if (productionHosts(domain).has(url.hostname.toLowerCase())) {
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

type Env = Readonly<Record<string, string | undefined>>

export interface BenchCredentials {
  /** A ready access token on the target (ASTRID_BENCH_TOKEN), or null to exchange the pair. */
  token: string | null
  clientId: string | null
  clientSecret: string | null
  /** Which variables the client pair came from, for the report. Never the values. */
  pairSource: 'ASTRID_BENCH_CLIENT_*' | 'ASTRID_OAUTH_CLIENT_*' | null
}

/**
 * Where the benchmark's credentials come from. A preview's own database knows the script OAuth
 * client (`ASTRID_OAUTH_CLIENT_ID` / `_SECRET`), so a client-credentials token exchanged on the
 * preview is enough and nobody has to mint ASTRID_BENCH_TOKEN by hand. The BENCH pair wins when
 * set, so a run can still use a client that exists only on the target.
 */
export function benchCredentials(env: Env): BenchCredentials {
  const token = env.ASTRID_BENCH_TOKEN?.trim() || null
  if (env.ASTRID_BENCH_CLIENT_ID && env.ASTRID_BENCH_CLIENT_SECRET) {
    return { token, clientId: env.ASTRID_BENCH_CLIENT_ID, clientSecret: env.ASTRID_BENCH_CLIENT_SECRET, pairSource: 'ASTRID_BENCH_CLIENT_*' }
  }
  if (env.ASTRID_OAUTH_CLIENT_ID && env.ASTRID_OAUTH_CLIENT_SECRET) {
    return { token, clientId: env.ASTRID_OAUTH_CLIENT_ID, clientSecret: env.ASTRID_OAUTH_CLIENT_SECRET, pairSource: 'ASTRID_OAUTH_CLIENT_*' }
  }
  return { token, clientId: null, clientSecret: null, pairSource: null }
}

/**
 * Why the stdio scenario cannot be trusted, or null. `mcp/astrid-mcp-launch.js` reloads the local
 * env file with `override: true`, so whatever the harness passes the child is replaced by the
 * file: an `ASTRID_API_BASE_URL` there would send the "preview" run to another origin (possibly
 * production), and a BENCH pair would silently become the file's script pair. `env` is the
 * harness's environment after loadScriptEnv(), which has the same file-wins values.
 */
export function stdioScenarioProblem(env: Env, origin: string, creds: BenchCredentials): string | null {
  const fileBase = env.ASTRID_API_BASE_URL?.trim()
  if (fileBase && fileBase.replace(/\/$/, '') !== origin.replace(/\/$/, '')) {
    return 'ASTRID_API_BASE_URL is set to another origin, and the stdio launcher would use it instead of --origin'
  }
  if (!creds.clientId || !creds.clientSecret) {
    return 'no client-credentials pair (ASTRID_BENCH_CLIENT_* or ASTRID_OAUTH_CLIENT_*)'
  }
  if (creds.pairSource === 'ASTRID_BENCH_CLIENT_*' && env.ASTRID_OAUTH_CLIENT_ID && env.ASTRID_OAUTH_CLIENT_ID !== creds.clientId) {
    return 'the stdio launcher reloads the env file and would replace the ASTRID_BENCH_CLIENT_* pair with ASTRID_OAUTH_CLIENT_*'
  }
  return null
}

/**
 * Why an MCP response is a failure, or null. A tool error comes back as HTTP 200 with
 * `result.isError` (or a JSON-RPC `error`), so status alone would time error messages as if they
 * were answers. Accepts a JSON body or a `text/event-stream` one (`data:` lines).
 */
export function rpcProblem(body: string): string | null {
  const payloads = body.trimStart().startsWith('{')
    ? [body]
    : body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
  if (payloads.length === 0) return 'no JSON-RPC message in the response'
  for (const payload of payloads) {
    let message: { error?: { message?: string }; result?: { isError?: boolean; content?: Array<{ text?: string }> } }
    try {
      message = JSON.parse(payload)
    } catch {
      return 'response is not JSON'
    }
    if (message.error) return `JSON-RPC error: ${message.error.message ?? 'unknown'}`
    if (message.result?.isError) return `tool error: ${(message.result.content?.[0]?.text ?? '').slice(0, 200)}`
  }
  return null
}
