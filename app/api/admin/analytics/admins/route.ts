/**
 * Admin Management API
 *
 * GET /api/admin/analytics/admins - List all admins
 * POST /api/admin/analytics/admins - Add a new admin
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { isAdmin, listAdmins, addAdminByEmail, AdminAuthError } from '@/lib/admin-auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin.analytics.admins')


/**
 * GET /api/admin/analytics/admins
 * List all admin users
 */
export async function GET() {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin access
    const admin = await isAdmin(session.user.id)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const admins = await listAdmins()

    return NextResponse.json({
      admins,
      meta: {
        total: admins.length,
      },
    })
  } catch (error) {
    log.error({ err: error }, '[Admin Management] GET error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/analytics/admins
 * Add a new admin user
 *
 * Body:
 * {
 *   email: string (required)
 * }
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin access
    const admin = await isAdmin(session.user.id)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await req.json()

    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json(
        { error: 'email is required and must be a string' },
        { status: 400 }
      )
    }

    const newAdmin = await addAdminByEmail(body.email.toLowerCase(), session.user.id)

    return NextResponse.json(
      {
        admin: newAdmin,
        message: `Successfully added ${body.email} as admin`,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    log.error({ err: error }, '[Admin Management] POST error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
