import { prisma } from './prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-auth')


// Initial admin email - this user gets admin access automatically
const INITIAL_ADMIN_EMAIL = 'jon@gracefultools.com'

export class AdminAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminAuthError'
  }
}

/**
 * Check if a user is an admin
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const adminUser = await prisma.adminUser.findUnique({
    where: { userId },
  })
  return !!adminUser
}

/**
 * Require admin access - throws if not admin
 */
export async function requireAdmin(userId: string): Promise<void> {
  const admin = await isAdmin(userId)
  if (!admin) {
    throw new AdminAuthError('Admin access required')
  }
}

/**
 * Add a new admin user
 */
export async function addAdmin(
  userId: string,
  grantedByUserId: string | null = null
): Promise<{ id: string; userId: string; createdAt: Date }> {
  // Check if granting user is admin (unless this is initial setup)
  if (grantedByUserId) {
    const grantorIsAdmin = await isAdmin(grantedByUserId)
    if (!grantorIsAdmin) {
      throw new AdminAuthError('Only admins can add new admins')
    }
  }

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })
  if (!user) {
    throw new AdminAuthError('User not found')
  }

  // Create admin entry
  const adminUser = await prisma.adminUser.create({
    data: {
      userId,
      grantedBy: grantedByUserId,
    },
  })

  return adminUser
}

/**
 * Remove an admin user
 */
export async function removeAdmin(
  userId: string,
  removedByUserId: string
): Promise<void> {
  // Cannot remove yourself
  if (userId === removedByUserId) {
    throw new AdminAuthError('Cannot remove yourself as admin')
  }

  // Check if removing user is admin
  const removerIsAdmin = await isAdmin(removedByUserId)
  if (!removerIsAdmin) {
    throw new AdminAuthError('Only admins can remove admins')
  }

  // Remove admin entry
  await prisma.adminUser.delete({
    where: { userId },
  })
}

/**
 * List all admin users
 */
export async function listAdmins(): Promise<
  Array<{
    id: string
    userId: string
    email: string
    name: string | null
    grantedBy: string | null
    createdAt: Date
  }>
> {
  const admins = await prisma.adminUser.findMany({
    include: {
      user: {
        select: {
          email: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })

  return admins.map((admin) => ({
    id: admin.id,
    userId: admin.userId,
    email: admin.user.email,
    name: admin.user.name,
    grantedBy: admin.grantedBy,
    createdAt: admin.createdAt,
  }))
}

/**
 * Ensure initial admin exists (call this on app startup or migration)
 */
export async function ensureInitialAdmin(): Promise<void> {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: INITIAL_ADMIN_EMAIL },
  })

  if (!user) {
    log.info(`Initial admin user ${INITIAL_ADMIN_EMAIL} not found in database`)
    return
  }

  // Check if already admin
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { userId: user.id },
  })

  if (!existingAdmin) {
    await prisma.adminUser.create({
      data: {
        userId: user.id,
        grantedBy: null, // Initial admin has no grantor
      },
    })
    log.info(`Created initial admin for ${INITIAL_ADMIN_EMAIL}`)
  }
}

/**
 * Get admin user by email (useful for adding admins by email)
 */
export async function addAdminByEmail(
  email: string,
  grantedByUserId: string
): Promise<{ id: string; userId: string; createdAt: Date }> {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  })

  if (!user) {
    throw new AdminAuthError(`User with email ${email} not found`)
  }

  // Check if already admin
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { userId: user.id },
  })

  if (existingAdmin) {
    throw new AdminAuthError(`User ${email} is already an admin`)
  }

  return addAdmin(user.id, grantedByUserId)
}
