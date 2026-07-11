/**
 * Google Contacts OAuth Authorization
 *
 * GET /api/contacts/google/authorize
 * Redirects user to Google OAuth consent screen for contacts access
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import crypto from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('contacts.google.authorize')


export async function GET(request: NextRequest) {
  // Require authentication
  const session = await getUnifiedSession()
  if (!session?.user) {
    return NextResponse.redirect(new URL('/auth/signin', request.url))
  }

  // Google OAuth configuration
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    log.error('[Google Contacts] GOOGLE_CLIENT_ID not configured')
    return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString('hex')

  // Store state in cookie for verification
  const response = NextResponse.redirect(buildGoogleAuthUrl(clientId, state, request))
  response.cookies.set('google_contacts_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/'
  })

  return response
}

function buildGoogleAuthUrl(clientId: string, state: string, request: NextRequest): URL {
  const baseUrl = process.env.NEXTAUTH_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`
  const redirectUri = `${baseUrl}/api/contacts/google/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  })

  return new URL(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
}
