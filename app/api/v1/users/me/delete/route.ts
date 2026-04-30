/**
 * POST /api/v1/users/me/delete
 *
 * Permanently deletes the authenticated user's account, including all
 * Vercel Blob files. Body must contain `{ confirmationText: "DELETE MY
 * ACCOUNT" }`. Mirrors POST /api/account/delete.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { del } from '@vercel/blob'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.delete')

export const POST = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.delete' },
  async (req, auth) => {
    try {
      const body = await req.json()
      const { confirmationText } = body

      if (confirmationText !== 'DELETE MY ACCOUNT') {
        return NextResponse.json(
          { error: "Invalid confirmation text. Please type 'DELETE MY ACCOUNT' exactly." },
          { status: 400 }
        )
      }

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: { secureFiles: true, accounts: true, authenticators: true },
      })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const hasOAuth = user.accounts.some(
        a => a.provider === 'google' || a.provider === 'github' || a.provider === 'apple'
      )
      const hasPasskey = user.authenticators.length > 0
      if (!hasOAuth && !hasPasskey) {
        return NextResponse.json(
          { error: 'Account authentication method not found' },
          { status: 400 }
        )
      }

      if (user.secureFiles.length > 0) {
        const results = await Promise.allSettled(
          user.secureFiles.map(f => del(f.blobUrl))
        )
        const failed = results.filter(r => r.status === 'rejected')
        if (failed.length > 0) {
          log.error({
            total: user.secureFiles.length,
            failed: failed.length,
          }, 'Failed to delete some files during account deletion')
        }
      }

      await prisma.user.delete({ where: { id: auth.userId } })

      return NextResponse.json({
        success: true as const,
        message: 'Account successfully deleted',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Account deletion error')
      return NextResponse.json(
        { error: 'Failed to delete account. Please try again or contact support.' },
        { status: 500 }
      )
    }
  }
)
