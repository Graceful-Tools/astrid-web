/**
 * Address Book Contacts API v1
 *
 * POST /api/v1/contacts - Upload/sync contacts from device address book
 * GET /api/v1/contacts - Get user's uploaded contacts
 * DELETE /api/v1/contacts - Clear all uploaded contacts
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { encryptField, decryptField } from '@/lib/field-encryption'
import { withAuth } from '@/lib/api-auth-wrapper'

interface ContactInput {
  email: string
  name?: string
  phoneNumber?: string
}

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
 * Body: { contacts: Array<{ email, name?, phoneNumber? }>, replaceAll?: boolean }
 */
export const POST = withAuth(
  { scopes: ['contacts:write'], tag: 'v1.contacts' },
  async (req, auth) => {
    const body = await req.json()
    const { contacts, replaceAll = true } = body

    if (!Array.isArray(contacts)) {
      return NextResponse.json({ error: 'contacts must be an array' }, { status: 400 })
    }

    const validContacts: { email: string; name: string | null; phoneNumber: string | null }[] = []
    const errors: string[] = []

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i] as ContactInput
      if (!contact.email || typeof contact.email !== 'string') {
        errors.push(`Contact at index ${i} is missing email`)
        continue
      }

      const email = contact.email.toLowerCase().trim()
      if (!email.includes('@')) {
        errors.push(`Invalid email at index ${i}: ${contact.email}`)
        continue
      }

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

    const result = await prisma.$transaction(async (tx) => {
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

      const toCreate = dedupedContacts.filter(c => !existingMap.has(c.email))
      const toUpdate = dedupedContacts.filter(c => existingMap.has(c.email))

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

      // Prisma's updateMany cannot vary values per row, so we fan out within the transaction
      if (toUpdate.length > 0) {
        await Promise.all(toUpdate.map(c =>
          tx.addressBookContact.update({
            where: { id: existingMap.get(c.email)! },
            data: { name: c.name, phoneNumber: c.phoneNumber },
          })
        ))
      }

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
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  }
)

/**
 * GET /api/v1/contacts
 * Get user's uploaded contacts
 *
 * Query params:
 * - limit: number (default: 100, max: 500)
 * - offset: number (default: 0)
 */
export const GET = withAuth(
  { scopes: ['contacts:read'], tag: 'v1.contacts' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
    const offset = parseInt(searchParams.get('offset') || '0')

    const [rawContacts, total] = await Promise.all([
      prisma.addressBookContact.findMany({
        where: { userId: auth.userId },
        orderBy: { email: 'asc' }, // name is encrypted, so we sort by email
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
  }
)

/**
 * DELETE /api/v1/contacts
 * Clear all uploaded contacts
 */
export const DELETE = withAuth(
  { scopes: ['contacts:write'], tag: 'v1.contacts' },
  async (_req, auth) => {
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
  }
)
