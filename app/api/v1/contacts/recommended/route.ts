/**
 * Recommended Collaborators API v1
 *
 * GET /api/v1/contacts/recommended - Get recommended collaborators based on mutual address book presence
 *
 * A user is recommended if:
 * 1. You have them in your address book (their email is in your contacts)
 * 2. They have you in their address book (your email is in their contacts)
 *
 * This "mutual contact" relationship indicates a real-world connection and is a strong
 * signal that the person would be a good collaborator.
 */

import { BRAND } from '@/lib/brand/config'
import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/field-encryption'
import { withAuth } from '@/lib/api-auth-wrapper'

/**
 * GET /api/v1/contacts/recommended
 * Get recommended collaborators based on mutual address book presence
 *
 * Query params:
 * - limit: number (default: 20, max: 100)
 * - excludeListId: optional list ID to exclude existing members
 */
export const GET = withAuth(
  { scopes: ['contacts:read'], tag: 'v1.contacts.recommended' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const excludeListId = searchParams.get('excludeListId')

    // Get the current user's email
    const currentUser = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { email: true }
    })

    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get emails to exclude (existing members of the list)
    let excludeUserIds: string[] = [auth.userId] // Always exclude self
    if (excludeListId) {
      const list = await prisma.taskList.findUnique({
        where: { id: excludeListId },
        include: {
          owner: { select: { id: true } },
          listMembers: { select: { userId: true } },
          listInvites: { select: { email: true } }
        }
      })

      if (list) {
        excludeUserIds = [
          list.ownerId,
          ...list.listMembers.map(m => m.userId),
        ]

        // Also get user IDs for pending invites
        const inviteEmails = list.listInvites.map(i => i.email)
        if (inviteEmails.length > 0) {
          const invitedUsers = await prisma.user.findMany({
            where: { email: { in: inviteEmails } },
            select: { id: true }
          })
          excludeUserIds.push(...invitedUsers.map(u => u.id))
        }
      }
    }

    // Find mutual contacts using a two-step query:
    // 1. Get all emails in my address book that belong to Astrid users
    // 2. Filter to only those users who also have my email in their address book

    // Step 1: Get emails I have in my contacts
    const myContacts = await prisma.addressBookContact.findMany({
      where: { userId: auth.userId },
      select: { email: true, name: true }
    })
    const myContactEmails = myContacts.map(c => c.email)
    // Decrypt contact names for display
    const myContactNameMap = new Map(myContacts.map(c => [c.email, decryptField(c.name)]))

    if (myContactEmails.length === 0) {
      return NextResponse.json({
        recommended: [],
        message: 'No contacts uploaded yet. Sync your address book to get recommendations.',
        meta: { apiVersion: 'v1', authSource: auth.source }
      })
    }

    // Step 2: Find Astrid users whose emails are in my contacts
    const usersInMyContacts = await prisma.user.findMany({
      where: {
        email: { in: myContactEmails },
        id: { notIn: excludeUserIds },
        isPlaceholder: false,
        isAIAgent: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      }
    })

    if (usersInMyContacts.length === 0) {
      return NextResponse.json({
        recommended: [],
        message: `None of your contacts are on ${BRAND.appName} yet.`,
        meta: { apiVersion: 'v1', authSource: auth.source }
      })
    }

    // Step 3: Filter to only those who have me in their address book (mutual)
    const potentialUserIds = usersInMyContacts.map(u => u.id)
    const theirContactsWithMe = await prisma.addressBookContact.findMany({
      where: {
        userId: { in: potentialUserIds },
        email: currentUser.email.toLowerCase(),
      },
      select: { userId: true }
    })
    const mutualUserIds = new Set(theirContactsWithMe.map(c => c.userId))

    // Build the recommended list with mutual contacts first
    const recommended = usersInMyContacts
      .map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        // Use contact name if user hasn't set their name
        contactName: myContactNameMap.get(user.email) || null,
        isMutual: mutualUserIds.has(user.id),
      }))
      .sort((a, b) => {
        // Mutual contacts first
        if (a.isMutual && !b.isMutual) return -1
        if (!a.isMutual && b.isMutual) return 1
        // Then alphabetically by display name
        const nameA = a.name || a.contactName || a.email
        const nameB = b.name || b.contactName || b.email
        return nameA.localeCompare(nameB)
      })
      .slice(0, limit)

    const mutualCount = recommended.filter(r => r.isMutual).length
    const nonMutualCount = recommended.filter(r => !r.isMutual).length

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        recommended,
        stats: {
          mutual: mutualCount,
          nonMutual: nonMutualCount,
          total: recommended.length,
        },
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)
