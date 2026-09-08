/**
 * The pages a browser-completed connect flow ends on.
 *
 * Moved out of the three callbacks so the resume-after-sign-in route
 * (task 842601f2) renders the same endings rather than a fourth set that drifts
 * from them.
 *
 * Everything here is 200 HTML on purpose: Cloudflare replaces raw 5xx responses
 * with its own error page, so an OAuth failure returned as 5xx is never seen by
 * the person who needs to read it.
 */

import { NextResponse } from 'next/server'

import { BRAND } from '@/lib/brand/config'
import type { OAuthStateProvider } from '@/lib/sync/oauth-state'

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function page(body: string): NextResponse {
  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">${body}</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/** Redirect the browser back to the app via its custom scheme so an in-app
 *  ASWebAuthenticationSession auto-dismisses and reopens the app (matching Google
 *  sign-in). Meta refresh plus a visible link for a plain browser — no inline
 *  <script>, which was the only one in the app and the reason script-src had to
 *  allow 'unsafe-inline' (task eea00b1b). */
function returnToApp(appUrl: string, heading: string, message: string): NextResponse {
  return new NextResponse(
    `<html><head>
      <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}">
    </head><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p>
      <p><a href="${escapeHtml(appUrl)}">Return to ${BRAND.appName}</a></p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export function linkSuccessPage(provider: OAuthStateProvider, account: string | null): NextResponse {
  const signedInAs = account ? `Signed in as <b>${escapeHtml(account)}</b>. ` : ''
  switch (provider) {
    case 'github':
      return page(`<h2>GitHub connected ✓</h2><p>${signedInAs}You can return to ${BRAND.appName}.</p>`)
    case 'copilot':
      return page(`<h2>GitHub Copilot connected ✓</h2><p>${signedInAs}You can return to ${BRAND.appName}.</p>`)
    case 'google':
      return returnToApp(
        `${BRAND.appUrlScheme}://google-tasks/connected`,
        'Google Tasks connected ✓',
        `${account ?? ''} — returning to ${BRAND.appName}…`,
      )
  }
}

/** Google's failure ALSO returns to the app (the scheme carries the message) so the
 *  in-app session closes and the app can surface the error natively. */
export function linkErrorPage(provider: OAuthStateProvider, message: string): NextResponse {
  if (provider === 'google') {
    return returnToApp(
      `${BRAND.appUrlScheme}://google-tasks/error?message=${encodeURIComponent(message)}`,
      "Connection didn't complete",
      message,
    )
  }
  return page(`<h2>Connection didn't complete</h2><p>${escapeHtml(message)}</p>`)
}

/** The copy each failure reason gets on a browser page. */
export function linkFailureMessage(reason: 'exchange_failed' | 'lookup_failed' | 'scope_missing'): string {
  switch (reason) {
    case 'scope_missing':
      return 'Google connected, but Tasks access was not granted. Reconnect and make sure the "Create, edit, organize, and delete all your tasks" box is CHECKED on the Google consent screen.'
    case 'lookup_failed':
      return `Connected, but the account lookup failed. Go back to ${BRAND.appName} and tap Connect again.`
    case 'exchange_failed':
      return `The sign-in code expired before it could be used. Go back to ${BRAND.appName} and tap Connect again.`
  }
}
