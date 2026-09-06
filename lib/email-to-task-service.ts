/**
 * Email-to-Task Service
 *
 * Handles conversion of emails to tasks via remindme@astrid.cc
 *
 * Email Routing Logic:
 * - TO: remindme@astrid.cc → Self-task (creates task for sender)
 * - CC: remindme@astrid.cc with TO: user@example.com → Assigned task
 * - CC: remindme@astrid.cc with multiple TO/CC → Group list with all recipients
 */

import { BRAND } from '@/lib/brand/config'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { prisma } from '@/lib/prisma'
import { placeholderUserService } from '@/lib/placeholder-user-service'
import type { User, Task, TaskList } from '@prisma/client'
import TurndownService from 'turndown'
import { createLogger } from '@/lib/logger'

const log = createLogger('email-to-task-service')


const REMINDME_EMAIL = BRAND.inboundTaskEmail

export interface ParsedEmail {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  bodyHtml?: string
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  filename: string
  content: string
  contentType: string
  size: number
}

export interface EmailToTaskResult {
  task: Task
  list?: TaskList
  createdUsers: User[]
  routing: 'self' | 'assigned' | 'group'
}

export class EmailToTaskService {
  private turndownService: TurndownService

  constructor() {
    // Initialize HTML to Markdown converter
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })
  }

  /**
   * Process an inbound email and create task(s)
   */
  async processEmail(email: ParsedEmail): Promise<EmailToTaskResult | null> {
    // Find the sender user
    const sender = await this.findOrCreateUserFromEmail(email.from)
    if (!sender) {
      log.error({ from: email.from }, 'Could not find or create sender')
      return null
    }

    // Check if user has email-to-task enabled
    if (!sender.emailToTaskEnabled) {
      log.info({ email: sender.email }, 'Email-to-task disabled for user')
      return null
    }

    // Determine routing type
    const routing = this.determineRouting(email)

    switch (routing) {
      case 'self':
        return await this.createSelfTask(sender, email)

      case 'assigned':
        return await this.createAssignedTask(sender, email)

      case 'group':
        return await this.createGroupTask(sender, email)

      default:
        log.error({ err: routing }, 'Unknown routing type:')
        return null
    }
  }

  /**
   * Determine email routing type based on TO/CC fields
   */
  private determineRouting(email: ParsedEmail): 'self' | 'assigned' | 'group' {
    const isInTo = email.to.some(addr => this.normalizeEmail(addr) === REMINDME_EMAIL)
    const isInCc = email.cc.some(addr => this.normalizeEmail(addr) === REMINDME_EMAIL)

    if (isInTo) {
      // remindme@astrid.cc in TO line → Self-task
      return 'self'
    }

    if (isInCc) {
      // remindme@astrid.cc in CC line
      const recipientCount = email.to.length + email.cc.filter(
        addr => this.normalizeEmail(addr) !== REMINDME_EMAIL
      ).length

      if (recipientCount === 1) {
        // Single recipient → Assigned task
        return 'assigned'
      } else {
        // Multiple recipients → Group task
        return 'group'
      }
    }

    // Fallback to self-task
    return 'self'
  }

  /**
   * Create a self-task (sender is creating task for themselves)
   */
  private async createSelfTask(
    sender: User,
    email: ParsedEmail
  ): Promise<EmailToTaskResult> {
    const task = await this.createTask({
      title: this.cleanSubject(email.subject),
      description: this.convertBodyToMarkdown(email.bodyHtml || email.body),
      creatorId: sender.id,
      assigneeId: sender.id,
      dueDateTime: this.calculateDueDate(sender),
      listId: sender.emailToTaskListId || null,
    })

    return {
      task,
      createdUsers: [],
      routing: 'self',
    }
  }

  /**
   * Create an assigned task (sender assigns task to single recipient)
   */
  private async createAssignedTask(
    sender: User,
    email: ParsedEmail
  ): Promise<EmailToTaskResult> {
    // Get the first TO recipient (excluding remindme@astrid.cc)
    const recipientEmail = email.to.find(
      addr => this.normalizeEmail(addr) !== REMINDME_EMAIL
    ) || email.cc.find(
      addr => this.normalizeEmail(addr) !== REMINDME_EMAIL
    )

    if (!recipientEmail) {
      // Fallback to self-task if no recipient found
      return await this.createSelfTask(sender, email)
    }

    // Find or create assignee (may be placeholder user)
    const assignee = await placeholderUserService.findOrCreatePlaceholderUser({
      email: recipientEmail,
      invitedBy: sender.id,
    })

    const task = await this.createTask({
      title: this.cleanSubject(email.subject),
      description: this.convertBodyToMarkdown(email.bodyHtml || email.body),
      creatorId: sender.id,
      assigneeId: assignee.id,
      dueDateTime: this.calculateDueDate(sender),
      listId: sender.emailToTaskListId || null,
    })

    return {
      task,
      createdUsers: assignee.isPlaceholder ? [assignee] : [],
      routing: 'assigned',
    }
  }

  /**
   * Create a group task (create shared list with all recipients)
   */
  private async createGroupTask(
    sender: User,
    email: ParsedEmail
  ): Promise<EmailToTaskResult> {
    // Get TO line recipients first (excluding remindme@astrid.cc and sender)
    const toRecipients = email.to
      .filter(addr => this.normalizeEmail(addr) !== REMINDME_EMAIL)
      .filter(addr => this.normalizeEmail(addr) !== sender.email)
      .map(addr => this.normalizeEmail(addr))

    // Get CC line recipients (excluding remindme@astrid.cc and sender)
    const ccRecipients = email.cc
      .filter(addr => this.normalizeEmail(addr) !== REMINDME_EMAIL)
      .filter(addr => this.normalizeEmail(addr) !== sender.email)
      .map(addr => this.normalizeEmail(addr))

    // Combine with TO recipients first to preserve priority
    const allRecipients = [...toRecipients, ...ccRecipients]

    // Remove duplicates while preserving order (TO recipients first)
    const uniqueEmails = Array.from(new Set(allRecipients))

    // Create shared list FIRST (before creating users)
    // This allows invitations to include the listId
    const listName = this.generateListName(email.subject, uniqueEmails)
    const list = await this.createSharedList({
      name: listName,
      ownerId: sender.id,
      adminUserIds: [sender.id], // Add sender first, will add others after user creation
    })

    // Find or create users for all recipients WITH the listId
    const recipientUsers = await placeholderUserService.findOrCreateMultiplePlaceholderUsers(
      uniqueEmails,
      sender.id,
      list.id // Pass listId so invitations include list context
    )

    // Update list to add all recipient users as members
    await prisma.listMember.createMany({
      data: recipientUsers.map(u => ({
        listId: list.id,
        userId: u.id,
        role: 'admin'
      })),
      skipDuplicates: true
    })

    // Determine assignee: first person from TO line
    const firstToRecipient = toRecipients[0]
    const assignee = firstToRecipient
      ? recipientUsers.find(u => this.normalizeEmail(u.email) === firstToRecipient)
      : recipientUsers[0]

    // Create task in the shared list
    const task = await this.createTask({
      title: this.cleanSubject(email.subject),
      description: this.convertBodyToMarkdown(email.bodyHtml || email.body),
      creatorId: sender.id,
      assigneeId: assignee?.id || sender.id, // Assign to first person from TO line, fallback to sender
      dueDateTime: this.calculateDueDate(sender),
      listId: list.id,
    })

    return {
      task,
      list,
      createdUsers: recipientUsers.filter(u => u.isPlaceholder),
      routing: 'group',
    }
  }

  /**
   * Create a task in the database
   */
  private async createTask(data: {
    title: string
    description: string
    creatorId: string
    assigneeId: string
    dueDateTime: Date | null
    listId: string | null
  }): Promise<Task> {
    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        creatorId: data.creatorId,
        assigneeId: data.assigneeId,
        dueDateTime: data.dueDateTime,
        priority: 0,
        completed: false,
        isPrivate: data.listId ? false : true,
        lists: data.listId
          ? {
              connect: [{ id: data.listId }]
            }
          : undefined,
      },
      include: {
        assignee: true,
        creator: true,
        lists: true,
      }
    })

    return task
  }

  /**
   * Create a shared list for group tasks
   */
  private async createSharedList(data: {
    name: string
    ownerId: string
    adminUserIds: string[]
  }): Promise<TaskList> {
    const list = await prisma.taskList.create({
      data: {
        name: data.name,
        description: `Created from email`,
        ownerId: data.ownerId,
        privacy: 'PRIVATE',
        color: DEFAULT_LIST_COLOR,
      },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        }
      }
    })

    // Add admin users as list members
    if (data.adminUserIds.length > 0) {
      await prisma.listMember.createMany({
        data: data.adminUserIds.map(userId => ({
          listId: list.id,
          userId,
          role: 'admin'
        })),
        skipDuplicates: true
      })
    }

    return list
  }

  /**
   * Find user by email or create placeholder user
   */
  private async findOrCreateUserFromEmail(email: string): Promise<User | null> {
    return await placeholderUserService.findUserByEmail(this.normalizeEmail(email))
  }

  /**
   * Calculate due date based on user's default offset
   */
  private calculateDueDate(user: User): Date | null {
    const offset = user.defaultTaskDueOffset || '1_week'
    const dueTime = user.defaultDueTime || '17:00'

    const now = new Date()
    let dueDate: Date

    switch (offset) {
      case '1_day':
        dueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        break
      case '3_days':
        dueDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
        break
      case '1_week':
        dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      case 'none':
        return null
      default:
        dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // Default 1 week
    }

    // Set time to user's default due time
    const [hours, minutes] = dueTime.split(':').map(Number)
    dueDate.setHours(hours, minutes, 0, 0)

    return dueDate
  }

  /**
   * Clean email subject (remove RE:, FW:, etc.)
   */
  private cleanSubject(subject: string): string {
    let cleaned = subject.trim()
    // Repeatedly remove RE:, FW:, FWD: prefixes (case-insensitive) until none remain
    while (/^(RE|FW|FWD):\s*/i.test(cleaned)) {
      cleaned = cleaned.replace(/^(RE|FW|FWD):\s*/i, '').trim()
    }
    return cleaned || 'Task from email'
  }

  /**
   * Convert HTML email body to Markdown
   */
  private convertBodyToMarkdown(body: string): string {
    // If body looks like HTML, convert to markdown
    if (body.includes('<')) {
      try {
        return this.turndownService.turndown(body)
      } catch (error) {
        log.error({ err: error }, 'Error converting HTML to markdown:')
        return body
      }
    }

    return body
  }

  /**
   * Generate list name from email subject and recipients
   */
  private generateListName(subject: string, recipients: string[] | User[]): string {
    const cleanSubject = this.cleanSubject(subject)

    // Handle both email strings and User objects
    const displayNames = recipients.map(r => {
      if (typeof r === 'string') {
        // Email string - extract name from email
        return r.split('@')[0]
      } else {
        // User object
        return r.name || r.email.split('@')[0]
      }
    })

    if (displayNames.length <= 2) {
      return `${cleanSubject} (${displayNames.join(', ')})`
    }

    return `${cleanSubject} (${displayNames.length} people)`
  }

  /**
   * Normalize email address to lowercase
   */
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim()
  }
}

// Export singleton instance
export const emailToTaskService = new EmailToTaskService()
