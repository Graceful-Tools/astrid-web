/**
 * Address Book Contacts API v1
 *
 * POST /api/v1/contacts - Upload/sync contacts from device address book
 * GET /api/v1/contacts - Get user's uploaded contacts
 * DELETE /api/v1/contacts - Clear all uploaded contacts
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { encryptField, decryptField, isEncrypted } from '@/lib/field-encryption'

interface ContactInput {
  email: string
  name?: string
  phoneNumber?: string
}

// Helper to decrypt contact fields for API response
function decryptContactForResponse(contact: {
  id: string
  email: string
  name: string | null
  phoneNumber: string | null
  uploadedAt?: Date
}) {
  return {
    ...contact,
    name: decryptField(contact.name),
    phoneNumber: decryptField(contact.phoneNumber),
  }
}

/**
 * POST /api/v1/contacts
 * Upload/sync contacts from device address book
 *
 * Body:
 * {
 *   contacts: Array<{ email: string, name?: string, phoneNumber?: string }>
 *   replaceAll?: boolean (default: true - clears existing before import)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['contacts:write'])

    const body = await req.json()
    const { contacts, replaceAll = true } = body

    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: 'contacts must be an array' },
        { status: 400 }
      )
    }

    // Validate and normalize contacts
    const validContacts: { email: string; name: string | null; phoneNumber: string | null }[] = []
    const errors: string[] = []

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i] as ContactInput
      if (!contact.email || typeof contact.email !== 'string') {
        errors.push(`Contact at index ${i} is missing email`)
        continue
      }

      // Basic email validation
      const email = contact.email.toLowerCase().trim()
      if (!email.includes('@')) {
        errors.push(`Invalid email at index ${i}: ${contact.email}`)
        continue
      }

      // Encrypt sensitive fields (name, phoneNumber) before storage
      const trimmedName = contact.name?.trim() || null
      const trimmedPhone = contact.phoneNumber?.trim() || null

      validContacts.push({
        email,
        name: trimmedName ? encryptField(trimmedName) : null,
        phoneNumber: trimmedPhone ? encryptField(trimmedPhone) : null,
      })
    }

    // Dedupe by email (keep last occurrence)
    const contactMap = new Map<string, typeof validContacts[0]>()
    for (const contact of validContacts) {
      contactMap.set(contact.email, contact)
    }
    const dedupedContacts = Array.from(contactMap.values())

    // Perform batch upsert in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // If replaceAll, delete existing contacts first
      if (replaceAll) {
        await tx.addressBookContact.deleteMany({
          where: { userId: auth.userId }
        })
      }

      // Batch-fetch existing contacts in one query (instead of N individual lookups)
      const existingContacts = replaceAll ? [] : await tx.addressBookContact.findMany({
        where: {
          userId: auth.userId,
          email: { in: dedupedContacts.map(c => c.email) },
        },
        select: { id: true, email: true },
      })
      const existingMap = new Map(existingContacts.map(c => [c.email, c.id]))

      // Split into creates and updates
      const toCreate = dedupedContacts.filter(c => !existingMap.has(c.email))
      const toUpdate = dedupedContacts.filter(c => existingMap.has(c.email))

      // Batch create new contacts
      if (toCreate.length > 0) {
        await tx.addressBookContact.createMany({
          data: toCreate.map(c => ({
            userId: auth.userId,
            email: c.email,
            name: c.name,
            phoneNumber: c.phoneNumber,
          })),
          skipDuplicates: true,
        })
      }

      // Batch update existing contacts (Prisma doesn't support updateMany with different values,
      // so we use Promise.all for parallel execution within the transaction)
      if (toUpdate.length > 0) {
        await Promise.all(toUpdate.map(c =>
          tx.addressBookContact.update({
            where: { id: existingMap.get(c.email)! },
            data: { name: c.name, phoneNumber: c.phoneNumber },
          })
        ))
      }

      // Get total count
      const total = await tx.addressBookContact.count({
        where: { userId: auth.userId }
      })

      return { created: toCreate.length, updated: toUpdate.length, total }
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'Contacts synced successfully',
        stats: {
          received: contacts.length,
          valid: dedupedContacts.length,
          created: result.created,
          updated: result.updated,
          total: result.total,
          errors: errors.length,
        },
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit errors in response
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] POST /contacts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/v1/contacts
 * Get user's uploaded contacts
 *
 * Query params:
 * - limit: number (default: 100, max: 500)
 * - offset: number (default: 0)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['contacts:read'])

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
    const offset = parseInt(searchParams.get('offset') || '0')

    const [rawContacts, total] = await Promise.all([
      prisma.addressBookContact.findMany({
        where: { userId: auth.userId },
        orderBy: { email: 'asc' }, // Order by email since name is encrypted
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          name: true,
          phoneNumber: true,
          uploadedAt: true,
        }
      }),
      prisma.addressBookContact.count({
        where: { userId: auth.userId }
      })
    ])

    // Decrypt sensitive fields before returning
    const contacts = rawContacts.map(decryptContactForResponse)

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        contacts,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + contacts.length < total,
        },
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] GET /contacts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/contacts
 * Clear all uploaded contacts
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['contacts:write'])

    const result = await prisma.addressBookContact.deleteMany({
      where: { userId: auth.userId }
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: 'All contacts deleted',
        deleted: result.count,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[API v1] DELETE /contacts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
