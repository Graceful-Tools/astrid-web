/**
 * Placeholder User Service
 *
 * Handles creation and management of placeholder users - users created when
 * tasks are assigned to non-registered email addresses.
 *
 * Features:
 * - Create placeholder users from email addresses
 * - Find or create placeholder users
 * - Upgrade placeholder users to full users on registration
 * - Auto-send invitations to placeholder users
 */

import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendInvitationEmail } from '@/lib/email'
import type { User } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('placeholder-user-service')


export interface PlaceholderUserOptions {
  email: string
  name?: string
  invitedBy: string
  taskId?: string
  listId?: string
}

export class PlaceholderUserService {
  /**
   * Find existing user (real or placeholder) by email
   */
  async findUserByEmail(email: string): Promise<User | null> {
    return await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    })
  }

  /**
   * Find or create a placeholder user for the given email address
   *
   * If user already exists (real or placeholder), returns existing user.
   * If user doesn't exist, creates a new placeholder user and sends invitation.
   */
  async findOrCreatePlaceholderUser(options: PlaceholderUserOptions): Promise<User> {
    const { email, name, invitedBy, taskId, listId } = options
    const normalizedEmail = email.toLowerCase()

    // Check if user already exists
    const existingUser = await this.findUserByEmail(normalizedEmail)
    if (existingUser) {
      return existingUser
    }

    // Extract name from email if not provided
    const displayName = name || this.extractNameFromEmail(normalizedEmail)

    // Create placeholder user
    const placeholderUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: displayName,
        isPlaceholder: true,
        invitedBy,
        emailVerified: null,
        isActive: true,
      }
    })

    // Send invitation email to the placeholder user
    await this.sendPlaceholderInvitation({
      placeholderUser,
      invitedBy,
      taskId,
      listId,
    })

    return placeholderUser
  }

  /**
   * Create multiple placeholder users at once (for group emails)
   */
  async findOrCreateMultiplePlaceholderUsers(
    emails: string[],
    invitedBy: string,
    listId?: string
  ): Promise<User[]> {
    const users = await Promise.all(
      emails.map(email =>
        this.findOrCreatePlaceholderUser({
          email,
          invitedBy,
          listId,
        })
      )
    )
    return users
  }

  /**
   * Upgrade a placeholder user to a full user
   *
   * Called when a placeholder user completes registration.
   * Preserves all existing task assignments and list memberships.
   */
  async upgradePlaceholderToFullUser(
    userId: string,
    userData: {
      name?: string | null
      password?: string | null
      emailVerified: Date
    }
  ): Promise<User> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...userData,
        isPlaceholder: false,
        invitedBy: null, // Clear invitedBy once upgraded
      }
    })

    return user
  }

  /**
   * Get all placeholder users created by a specific user
   */
  async getPlaceholderUsersCreatedBy(userId: string): Promise<User[]> {
    return await prisma.user.findMany({
      where: {
        isPlaceholder: true,
        invitedBy: userId,
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
  }

  /**
   * Get statistics about placeholder users
   */
  async getPlaceholderUserStats(userId: string): Promise<{
    total: number
    withTasks: number
    withLists: number
  }> {
    const placeholders = await prisma.user.findMany({
      where: {
        isPlaceholder: true,
        invitedBy: userId,
      },
      include: {
        assignedTasks: {
          where: { completed: false }
        },
        listMemberships: true,
      }
    })

    return {
      total: placeholders.length,
      withTasks: placeholders.filter(p => p.assignedTasks.length > 0).length,
      withLists: placeholders.filter(p => p.listMemberships.length > 0).length,
    }
  }

  /**
   * Check if a user can be upgraded (is placeholder and email matches)
   */
  async canUpgradePlaceholder(email: string): Promise<{
    canUpgrade: boolean
    placeholderUser: User | null
  }> {
    const user = await this.findUserByEmail(email)

    if (!user) {
      return { canUpgrade: false, placeholderUser: null }
    }

    return {
      canUpgrade: user.isPlaceholder === true,
      placeholderUser: user.isPlaceholder ? user : null
    }
  }

  /**
   * Send invitation email to placeholder user
   */
  private async sendPlaceholderInvitation(options: {
    placeholderUser: User
    invitedBy: string
    taskId?: string
    listId?: string
  }) {
    const { placeholderUser, invitedBy, taskId, listId } = options

    // Get the inviter details
    const inviter = await prisma.user.findUnique({
      where: { id: invitedBy }
    })

    if (!inviter) {
      log.error({ err: invitedBy }, 'Inviter not found:')
      return
    }

    // Create invitation record
    const invitation = await prisma.invitation.create({
      data: {
        email: placeholderUser.email,
        token: this.generateInvitationToken(),
        type: taskId ? 'TASK_ASSIGNMENT' : 'LIST_SHARING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        senderId: inviter.id,
        receiverId: placeholderUser.id,
        taskId,
        listId,
        message: `You've been invited to collaborate on tasks${listId ? ' in a shared list' : ''}`,
      }
    })

    // Send email invitation
    await sendInvitationEmail({
      id: invitation.id,
      email: placeholderUser.email,
      token: invitation.token,
      type: invitation.type,
      expiresAt: invitation.expiresAt,
      sender: {
        name: inviter.name,
        email: inviter.email,
      },
      taskId,
      listId,
      message: invitation.message,
    })
  }

  /**
   * Extract display name from email address
   * Example: john.doe@example.com -> John Doe
   */
  private extractNameFromEmail(email: string): string {
    const localPart = email.split('@')[0]

    // Replace common separators with spaces
    const withSpaces = localPart
      .replace(/[._-]/g, ' ')
      .trim()

    // Capitalize each word
    const capitalized = withSpaces
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')

    return capitalized || 'User'
  }

  /**
   * Generate cryptographically secure invitation token
   */
  private generateInvitationToken(): string {
    // Generate 32 bytes of cryptographically secure random data
    return randomBytes(32).toString('hex')
  }
}

// Export singleton instance
export const placeholderUserService = new PlaceholderUserService()
