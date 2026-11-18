/**
 * The one HTTP client the loop scripts use (ADEV-9). They used to each carry their own copy of
 * the OAuth exchange and the fetch calls; `astrid-agent` (packages/astrid-sdk) has that code,
 * so the scripts are thin wrappers over its `AstridClient`.
 */

import { AstridClient } from '../../packages/astrid-sdk/src/client'
import { brandOrigin, mcpDefaultBaseUrl } from '../../lib/brand/config'

/** This brand's own origin (`https://astrid.cc` for Astrid), with nothing configured. */
export const ASTRID_API = brandOrigin()

/**
 * The API origin every loop script calls: `ASTRID_API_URL`, else `ASTRID_API_BASE_URL`, else
 * the brand's origin (mcpDefaultBaseUrl). These scripts hardcoded `https://astrid.cc`, so a
 * fork's loop talked to Astrid's API (ADEV-103).
 */
export function scriptApiOrigin(): string {
  return process.env.ASTRID_API_URL?.trim() || mcpDefaultBaseUrl()
}

/** A client for the script OAuth client in the environment, at scriptApiOrigin(). */
export function scriptClient(input: {
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  origin?: string
}): AstridClient {
  return new AstridClient({
    origin: input.origin ?? scriptApiOrigin(),
    auth: { clientId: input.clientId, clientSecret: input.clientSecret },
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
  })
}
