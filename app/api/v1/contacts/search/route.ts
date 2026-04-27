/**
 * Contacts Search API v1
 *
 * GET /api/v1/contacts/search - Search contacts for autocomplete when adding members
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/field-encryption'
import { withAuth } from '@/lib/api-auth-wrapper'

/**
 * GET /api/v1/contacts/search
 * Search contacts for autocomplete
 *
 * Query params:
 * - q: search query (searches name and email)
 * - limit: number (default: 10, max: 50)
 * - excludeListId: optional list ID to exclude existing members
 */
export const GET = withAuth(
  { scopes: ['contacts:read'], tag: 'v1.contacts.search' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q')?.trim().toLowerCase()
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
    const excludeListId = searchParams.get('excludeListId')

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: 'Query must be at least 2 characters' },
        { status: 400 }
      )
    }

    // Get emails to exclude (existing members of the list)
    let excludeEmails: string[] = []
    if (excludeListId) {
      const list = await prisma.taskList.findUnique({
        where: { id: excludeListId },
        include: {
          owner: { select: { email: true } },
          listMembers: {
            include: { user: { select: { email: true } } }
          },
          listInvites: { select: { email: true } }
        }
      })

      if (list) {
        excludeEmails = [
          list.owner.email,
          ...list.listMembers.map(m => m.user.email),
          ...list.listInvites.map(i => i.email),
        ].filter(Boolean) as string[]
      }
    }

    // Search contacts - only by email since name is encrypted
    // Note: name field is encrypted so we can't search it in the database
    const rawContacts = await prisma.addressBookContact.findMany({
      where: {
        userId: auth.userId,
        email: excludeEmails.length > 0
          ? { notIn: excludeEmails, contains: query, mode: 'insensitive' }
          : { contains: query, mode: 'insensitive' },
      },
      orderBy: [
        { email: 'asc' },
      ],
      take: limit,
      select: {
        id: true,
        email: true,
        name: true,
        phoneNumber: true,
      }
    })

    // Decrypt sensitive fields for response
    const contacts = rawContacts.map(contact => ({
      ...contact,
      name: decryptField(contact.name),
      phoneNumber: decryptField(contact.phoneNumber),
    }))

    // Also check if any contacts are existing Astrid users
    const contactEmails = contacts.map(c => c.email)
    const existingUsers = await prisma.user.findMany({
      where: {
        email: { in: contactEmails },
        isPlaceholder: false,
      },
      select: {
        email: true,
        name: true,
        image: true,
      }
    })

    const userMap = new Map(existingUsers.map(u => [u.email, u]))

    // Enrich contacts with user info if they're Astrid users
    const enrichedContacts = contacts.map(contact => {
      const user = userMap.get(contact.email)
      return {
        ...contact,
        isAstridUser: !!user,
        astridUserName: user?.name || null,
        astridUserImage: user?.image || null,
      }
    })

    // Sort: Astrid users first, then alphabetically
    enrichedContacts.sort((a, b) => {
      if (a.isAstridUser && !b.isAstridUser) return -1
      if (!a.isAstridUser && b.isAstridUser) return 1
      return (a.name || a.email).localeCompare(b.name || b.email)
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        results: enrichedContacts,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)
