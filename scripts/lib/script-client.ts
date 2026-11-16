/**
 * The one HTTP client the loop scripts use (ADEV-9). They used to each carry their own copy of
 * the OAuth exchange and the fetch calls; `astrid-agent` (packages/astrid-sdk) has that code,
 * so the scripts are thin wrappers over its `AstridClient`.
 */

import { AstridClient } from '../../packages/astrid-sdk/src/client'

export const ASTRID_API = 'https://astrid.cc'

/**
 * A client for the script OAuth client in the environment. The origin stays `astrid.cc` unless
 * `ASTRID_API_URL` says otherwise, which is what these scripts always called.
 */
export function scriptClient(input: {
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  origin?: string
}): AstridClient {
  return new AstridClient({
    origin: input.origin ?? process.env.ASTRID_API_URL ?? process.env.ASTRID_API_BASE_URL ?? ASTRID_API,
    auth: { clientId: input.clientId, clientSecret: input.clientSecret },
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
  })
}
