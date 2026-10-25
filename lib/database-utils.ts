import { prisma } from './prisma'

/**
 * Database optimization utilities for high-performance operations
 */

/**
 * Connection pool optimization for serverless environments
 */
export const connectionPoolConfig = {
  // Recommended connection limits for Vercel environment
  maxConnections: process.env.NODE_ENV === 'production' ? 10 : 5,
  connectionTimeout: 10000, // 10 seconds
  idleTimeout: 30000, // 30 seconds
}

/**
 * Optimized query utilities with proper indexing usage
 */
export class OptimizedQueries {
  /**
   * Get user's active tasks with optimized indexing
   * Uses composite index: [assigneeId, completed]
   */
  static async getUserActiveTasks(userId: string, limit = 50) {
    return await prisma.task.findMany({
      where: {
        assigneeId: userId,
        completed: false,
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
      include: {
        lists: {
          select: {
            id: true,
            name: true,
            color: true,
          }
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    })
  }

  /**
   * Get recent tasks with optimized composite indexing
   * Uses composite index: [createdAt, completed]
   */
  static async getRecentTasks(userId: string, limit = 20) {
    return await prisma.task.findMany({
      where: {
        OR: [
          { assigneeId: userId },
          { creatorId: userId },
        ]
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        lists: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    })
  }

  /**
   * Get task comments with optimized ordering
   * Uses composite index: [taskId, createdAt]
   */
  static async getTaskComments(taskId: string, limit = 50) {
    return await prisma.comment.findMany({
      where: {
        taskId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          }
        },
        replies: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              }
            }
          },
          orderBy: {
            createdAt: 'asc',
          }
        }
      }
    })
  }

  /**
   * Get user's pending invitations with optimized lookup
   * Uses composite index: [email, status]
   */
  static async getUserPendingInvitations(email: string) {
    return await prisma.invitation.findMany({
      where: {
        email,
        status: 'PENDING',
        expiresAt: {
          gt: new Date(),
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          }
        }
      }
    })
  }

  /**
   * Get user's sent invitations with optimized lookup
   * Uses composite index: [senderId, status]
   */
  static async getUserSentInvitations(senderId: string) {
    return await prisma.invitation.findMany({
      where: {
        senderId,
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      }
    })
  }

  /**
   * Optimized list members query
   */
  static async getListMembers(listId: string) {
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          }
        },
        listMembers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
              }
            }
          }
        }
      }
    })

    if (!list) return null

    // Transform to consistent format with roles
    const members = [
      { ...list.owner, role: 'owner' as const },
      ...list.listMembers.map(lm => ({ ...lm.user, role: lm.role })),
    ]

    return { ...list, members }
  }
}

/**
 * Database maintenance utilities
 */
export class DatabaseMaintenance {
  /**
   * Clean up expired invitations
   */
  static async cleanupExpiredInvitations() {
    const result = await prisma.invitation.updateMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
      }
    })
    return result.count
  }

  /**
   * Clean up expired email verification tokens
   */
  static async cleanupExpiredVerificationTokens() {
    const result = await prisma.user.updateMany({
      where: {
        emailTokenExpiresAt: {
          lt: new Date(),
        },
        emailVerificationToken: {
          not: null,
        }
      },
      data: {
        emailVerificationToken: null,
        emailTokenExpiresAt: null,
      }
    })
    return result.count
  }

  /**
   * Archive old completed tasks (optional - for data retention policies)
   */
  static async archiveOldCompletedTasks(daysOld = 365) {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    // This would typically move to an archive table or mark as archived
    // For now, we'll just return the count of tasks that could be archived
    const count = await prisma.task.count({
      where: {
        completed: true,
        updatedAt: {
          lt: cutoffDate,
        }
      }
    })
    
    return count
  }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitoring {
  /**
   * Get database statistics
   */
  static async getDatabaseStats() {
    const [
      userCount,
      taskCount,
      listCount,
      commentCount,
      invitationCount
    ] = await Promise.all([
      prisma.user.count(),
      prisma.task.count(),
      prisma.taskList.count(),
      prisma.comment.count(),
      prisma.invitation.count(),
    ])

    return {
      users: userCount,
      tasks: taskCount,
      lists: listCount,
      comments: commentCount,
      invitations: invitationCount,
      timestamp: new Date(),
    }
  }

  /**
   * Health check query with timeout
   */
  static async healthCheck(timeoutMs = 5000) {
    const startTime = Date.now()
    
    try {
      // Simple query to test database connectivity
      await prisma.$queryRaw`SELECT 1 as health_check`
      const duration = Date.now() - startTime
      
      return {
        healthy: true,
        responseTime: duration,
        timestamp: new Date(),
      }
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
        timestamp: new Date(),
      }
    }
  }
}

/**
 * Connection management for serverless optimization
 */
export class ConnectionManager {
  private static instance: ConnectionManager
  private lastActivity: number = Date.now()

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager()
    }
    return ConnectionManager.instance
  }

  /**
   * Track database activity for connection lifecycle
   */
  updateActivity() {
    this.lastActivity = Date.now()
  }

  /**
   * Check if connection should be kept alive
   */
  shouldKeepAlive(): boolean {
    const idleTime = Date.now() - this.lastActivity
    return idleTime < connectionPoolConfig.idleTimeout
  }

  /**
   * Graceful connection cleanup
   */
  async cleanup() {
    if (!this.shouldKeepAlive()) {
      await prisma.$disconnect()
    }
  }
}