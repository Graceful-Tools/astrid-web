import { prisma } from './prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin-auth')


/**
 * Address that receives admin on bootstrap, from the environment.
 *
 * This was a hardcoded personal address, which was wrong twice over
 * (task 7610dd07). A whitelabel partner could not change it, so their
 * deployment bootstrapped an admin belonging to somebody else's company; and
 * because passkey registration creates a User for any address with no proof of
 * ownership, on any deployment where that row did not exist yet an attacker
 * could register a passkey for it and be granted admin by the daily cron.
 *
 * Unset means nobody is bootstrapped. That is the safe default: an operator who
 * wants an initial admin says so, and an operator who says nothing does not
 * silently acquire one.
 */
function initialAdminEmail(): string | null {
  const configured = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase()
  return configured ? configured : null
}

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
  const adminEmail = initialAdminEmail()
  if (!adminEmail) {
    return
  }

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: adminEmail },
  })

  if (!user) {
    log.info(`Initial admin user ${adminEmail} not found in database`)
    return
  }

  // Owning the address is the whole claim being made here, and holding the row
  // is not owning the address: a passkey signup creates a User for any address
  // with emailVerified left null on purpose. Without this check, registering a
  // passkey for the bootstrap address was enough to be granted admin by the
  // next run of the analytics cron.
  if (!user.emailVerified) {
    log.warn(
      { userId: user.id },
      'Initial admin account has an unverified email — refusing to grant admin',
    )
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
    log.info(`Created initial admin for ${adminEmail}`)
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
