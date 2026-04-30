/**
 * GET /api/v1/users/me — Account info + verification status
 * PUT /api/v1/users/me — Update name/email/image
 *
 * Mirrors GET/PUT /api/account.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { sendEmailVerification, checkEmailVerificationStatus } from '@/lib/email-verification'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me')

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: {
          id: true, name: true, email: true, emailVerified: true,
          image: true, pendingEmail: true, createdAt: true, updatedAt: true,
        },
      })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const verificationStatus = await checkEmailVerificationStatus(user.id)

      return NextResponse.json({
        user: { ...user, ...verificationStatus },
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching account')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

interface UpdateAccountData {
  name?: string
  email?: string
  image?: string
}

export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me' },
  async (req, auth) => {
    try {
      const data: UpdateAccountData = await req.json()

      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }
      if (data.name && data.name.length > 100) {
        return NextResponse.json({ error: 'Name too long' }, { status: 400 })
      }

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, email: true, name: true },
      })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const updateData: { name?: string | null; image?: string | null } = {}
      let emailVerificationRequired = false

      if (data.name !== undefined && data.name !== user.name) {
        updateData.name = data.name.trim() || null
      }
      if (data.image !== undefined) {
        updateData.image = data.image || null
      }

      if (data.email && data.email !== user.email) {
        const existing = await prisma.user.findFirst({
          where: { email: data.email.toLowerCase(), NOT: { id: auth.userId } },
        })
        if (existing) {
          return NextResponse.json(
            { error: 'Email address is already in use' },
            { status: 409 }
          )
        }
        const verResult = await sendEmailVerification(auth.userId, data.email.toLowerCase(), true)
        if (!verResult.success) {
          return NextResponse.json({ error: verResult.message }, { status: 500 })
        }
        emailVerificationRequired = true
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({ where: { id: auth.userId }, data: updateData })
      }

      const response: {
        success: true
        message: string
        emailVerificationRequired?: boolean
        meta: { apiVersion: 'v1'; authSource: string }
      } = {
        success: true,
        message: emailVerificationRequired
          ? 'Account updated successfully. Please check your email to verify the new address.'
          : 'Account updated successfully',
        meta: { apiVersion: 'v1', authSource: auth.source },
      }
      if (emailVerificationRequired) response.emailVerificationRequired = true

      return NextResponse.json(response)
    } catch (error) {
      log.error({ err: error }, 'Error updating account')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
