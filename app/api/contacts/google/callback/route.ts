/**
 * Google Contacts OAuth Callback
 *
 * GET /api/contacts/google/callback
 * Handles OAuth callback, fetches contacts, and stores them
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/field-encryption'
import { safeResponseJson } from '@/lib/safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('contacts.google.callback')


interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  scope: string
  refresh_token?: string
}

interface GoogleContact {
  resourceName: string
  names?: Array<{ displayName?: string }>
  emailAddresses?: Array<{ value: string }>
  phoneNumbers?: Array<{ value: string }>
}

interface GooglePeopleResponse {
  connections?: GoogleContact[]
  nextPageToken?: string
  totalPeople?: number
}

export async function GET(request: NextRequest) {
  // Require authentication
  const session = await getServerSession(authConfig)
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/auth/signin', request.url))
  }

  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Check for OAuth errors
  if (error) {
    log.error({ err: error }, '[Google Contacts] OAuth error:')
    return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
  }

  if (!code || !state) {
    log.error('[Google Contacts] Missing code or state')
    return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
  }

  // Verify state
  const storedState = request.cookies.get('google_contacts_state')?.value
  if (!storedState || storedState !== state) {
    log.error('[Google Contacts] State mismatch')
    return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
  }

  try {
    // Exchange code for tokens
    const baseUrl = process.env.NEXTAUTH_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`
    const redirectUri = `${baseUrl}/api/contacts/google/callback`

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      log.error({ err: errorText }, '[Google Contacts] Token exchange failed:')
      return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json()

    // Fetch contacts from Google People API
    const contacts = await fetchAllGoogleContacts(tokens.access_token)

    // Filter contacts with email addresses
    const contactsWithEmail = contacts.filter(
      (c) => c.emailAddresses && c.emailAddresses.length > 0
    )

    // Store contacts in database
    const importedCount = await storeContacts(session.user.id, contactsWithEmail)

    log.info(`[Google Contacts] Imported ${importedCount} contacts for user ${session.user.id}`)

    // Clear state cookie and redirect
    const response = NextResponse.redirect(
      new URL(`/settings/contacts?google=success&imported=${importedCount}`, request.url)
    )
    response.cookies.delete('google_contacts_state')

    return response
  } catch (error) {
    log.error({ err: error }, '[Google Contacts] Error:')
    return NextResponse.redirect(new URL('/settings/contacts?google=error', request.url))
  }
}

async function fetchAllGoogleContacts(accessToken: string): Promise<GoogleContact[]> {
  const allContacts: GoogleContact[] = []
  let pageToken: string | undefined
  const maxRetries = 3
  const baseDelay = 1000 // 1 second

  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers')
    url.searchParams.set('pageSize', '1000')
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    let lastError: Error | null = null
    let retryCount = 0

    // Retry logic with exponential backoff
    while (retryCount < maxRetries) {
      try {
        // Add 30s timeout per request
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => abortController.abort(), 30000)

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: abortController.signal,
        })

        clearTimeout(timeoutId)

        // Only retry on 5xx errors and 429 (rate limit)
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) {
            const errorText = await response.text()
            log.warn({ errorText }, `⚠️ [Google Contacts] Retryable error (${response.status}), attempt ${retryCount + 1}/${maxRetries}:`)

            // Exponential backoff: 1s, 2s, 4s
            const delay = baseDelay * Math.pow(2, retryCount)
            await new Promise(resolve => setTimeout(resolve, delay))

            retryCount++
            continue
          } else {
            // 4xx errors (except 429) should not be retried
            const errorText = await response.text()
            log.error({
              status: response.status,
              error: errorText
            }, '❌ [Google Contacts] Non-retryable error:')
            break
          }
        }

        const data = await safeResponseJson<GooglePeopleResponse>(response, null)

        if (!data) {
          log.error('❌ [Google Contacts] Empty response from People API')
          break
        }

        if (data.connections) {
          allContacts.push(...data.connections)
        }
        pageToken = data.nextPageToken

        // Success - break retry loop
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        log.warn({
          error: lastError.message,
          isAbortError: lastError.name === 'AbortError'
        }, `⚠️ [Google Contacts] Network error, attempt ${retryCount + 1}/${maxRetries}:`)

        if (retryCount < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, retryCount)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        retryCount++
      }
    }

    // If all retries failed, log and break
    if (retryCount >= maxRetries && lastError) {
      log.error({ message: lastError.message }, '❌ [Google Contacts] All retry attempts failed')
      break
    }
  } while (pageToken)

  return allContacts
}

async function storeContacts(userId: string, contacts: GoogleContact[]): Promise<number> {
  // Prepare contacts for upsert, encrypting sensitive fields
  const contactData = contacts.flatMap((contact) => {
    const name = contact.names?.[0]?.displayName || null
    const phone = contact.phoneNumbers?.[0]?.value || null

    return (contact.emailAddresses || []).map((email) => ({
      userId,
      email: email.value.toLowerCase().trim(),
      // Encrypt sensitive fields before storage
      name: name ? encryptField(name) : null,
      phoneNumber: phone ? encryptField(phone) : null,
    }))
  })

  // Dedupe by email
  const uniqueContacts = new Map<string, typeof contactData[0]>()
  for (const contact of contactData) {
    uniqueContacts.set(contact.email, contact)
  }

  // Delete existing contacts and insert new ones (full replace)
  await prisma.$transaction(async (tx) => {
    await tx.addressBookContact.deleteMany({
      where: { userId },
    })

    if (uniqueContacts.size > 0) {
      await tx.addressBookContact.createMany({
        data: Array.from(uniqueContacts.values()),
      })
    }
  })

  return uniqueContacts.size
}
