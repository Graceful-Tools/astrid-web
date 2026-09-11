/**
 * Process-level OAuth token cache for the hosted Streamable HTTP path
 * (task 11f578e0).
 *
 * `pages/api/mcp/index.ts` constructs a new `AstridMCPServerOAuth` per POST,
 * so the per-instance cache inside `OAuthAPIClient` never hit for Basic-auth
 * sessions: every JSON-RPC request minted a fresh token via
 * `client_credentials`, multiplying token-endpoint load and risking
 * `oauthTokenRateLimiter` (20 requests/minute/IP).
 *
 * Entries are keyed by SHA-256 of baseUrl + clientId + clientSecret, never by
 * the raw credentials. A rotated secret therefore lands on a different key
 * rather than reusing a stale token. Static-access-token sessions never reach
 * here — they do not touch the token endpoint at all.
 *
 * The cache is per serverless instance, so it bounds token minting rather
 * than eliminating it: a cold instance mints once, then reuses.
 */

import crypto from "crypto"

export interface HostedTokenEntry {
  accessToken: string
  /** Epoch ms after which the entry must not be reused. */
  expiry: number
}

const hostedTokenCache = new Map<string, HostedTokenEntry>()
/** In-flight mints, so concurrent POSTs coalesce onto one token request. */
const hostedTokenInflight = new Map<string, Promise<HostedTokenEntry>>()

export function hostedTokenCacheKey(
  baseUrl: string,
  clientId: string,
  clientSecret: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${baseUrl}\n${clientId}\n${clientSecret}`, "utf8")
    .digest("hex")
}

/**
 * Drop entries past their expiry. One process serves many users' credentials,
 * and a credential set that stops connecting is never looked up again — so
 * without this the Map only ever grows. Called on write, the only moment the
 * map can gain an entry.
 */
function sweepExpired(now: number): void {
  for (const [key, entry] of hostedTokenCache) {
    if (now >= entry.expiry) {
      hostedTokenCache.delete(key)
    }
  }
}

/**
 * Return a live cached token for `key`, or mint one via `mint` — coalescing
 * concurrent callers onto a single mint.
 */
export async function withHostedTokenCache(
  key: string,
  mint: () => Promise<HostedTokenEntry>
): Promise<HostedTokenEntry> {
  const cached = hostedTokenCache.get(key)
  if (cached && Date.now() < cached.expiry) {
    return cached
  }

  const inflight = hostedTokenInflight.get(key)
  if (inflight) {
    return inflight
  }

  const pending = mint().then(entry => {
    sweepExpired(Date.now())
    hostedTokenCache.set(key, entry)
    return entry
  })

  hostedTokenInflight.set(key, pending)
  try {
    return await pending
  } finally {
    hostedTokenInflight.delete(key)
  }
}

/** Test-only view of the cache's size (task 11f578e0). */
export function hostedTokenCacheSize(): number {
  return hostedTokenCache.size
}
