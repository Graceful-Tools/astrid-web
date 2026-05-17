/**
 * Host routing for Google sign-in.
 *
 * NextAuth (v4) builds the Google OAuth `redirect_uri` from the request
 * host. Only `astrid.cc` is whitelisted in the Google Cloud OAuth client,
 * so starting sign-in on a preview subdomain (`feature-x.astrid.cc`)
 * sends an un-whitelisted redirect_uri and Google returns
 * `Error 400: redirect_uri_mismatch`.
 *
 * The fix: on a non-canonical host, bounce the user to the canonical
 * `astrid.cc` sign-in page (which runs OAuth normally) and pass the
 * preview origin as `callbackUrl` so they're returned there afterwards.
 * The session cookie is `.astrid.cc`-scoped, so the preview is
 * authenticated once the user lands back on it.
 */

/** Hosts where the Google OAuth redirect_uri is whitelisted / OAuth can run locally. */
export function isCanonicalAuthHost(host: string): boolean {
  const hostname = host.toLowerCase().split(':')[0]
  return (
    hostname === 'astrid.cc' ||
    hostname === 'www.astrid.cc' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  )
}

export type GoogleSignInPlan =
  | { mode: 'direct' }
  | { mode: 'redirect'; url: string }

/**
 * Decide how to start Google sign-in given the origin the user is on.
 * - Canonical host  → `direct`: run `signIn('google')` here.
 * - Anything else   → `redirect`: send the browser to the canonical
 *   sign-in page, carrying this origin as `callbackUrl` so the user is
 *   returned here after authenticating.
 */
export function planGoogleSignIn(currentOrigin: string): GoogleSignInPlan {
  let url: URL
  try {
    url = new URL(currentOrigin)
  } catch {
    return { mode: 'direct' }
  }

  if (isCanonicalAuthHost(url.host)) {
    return { mode: 'direct' }
  }

  const returnOrigin = `${url.protocol}//${url.host}/`
  return {
    mode: 'redirect',
    url: `https://astrid.cc/auth/signin?callbackUrl=${encodeURIComponent(returnOrigin)}`,
  }
}

/**
 * True when `url` points at astrid.cc or any `*.astrid.cc` subdomain over
 * https. Used by the NextAuth redirect callback to allow returning a
 * signed-in user to a preview deploy. Strict enough to reject look-alike
 * domains so it cannot become an open redirect.
 */
export function isAstridSubdomainUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return parsed.hostname === 'astrid.cc' || parsed.hostname.endsWith('.astrid.cc')
}
