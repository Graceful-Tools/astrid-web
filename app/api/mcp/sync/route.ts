import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('mcp.sync')


/**
 * Incremental Sync Endpoint for Mobile Clients
 *
 * Allows clients to sync only changes since their last sync checkpoint
 * Reduces bandwidth and improves performance for mobile apps
 *
 * Request body:
 * {
 *   "accessToken": "mcp_token",
 *   "lastSyncTimestamp": "2024-01-01T00:00:00.000Z"  // ISO 8601 timestamp
 * }
 *
 * Response:
 * {
 *   "lists": { "created": [], "updated": [], "deleted": [] },
 *   "tasks": { "created": [], "updated": [], "deleted": [] },
 *   "syncTimestamp": "2024-01-01T12:00:00.000Z"
 * }
 */
export async function POST(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  try {
    const { accessToken, lastSyncTimestamp } = await request.json()

    if (!accessToken) {
      return NextResponse.json(
        { error: "Access token required" },
        { status: 400 }
      )
    }

    // Validate MCP token
    const mcpToken = await prisma.mCPToken.findFirst({
      where: {
        token: accessToken,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } }
        ]
      },
      include: {
        user: { select: { id: true } }
      }
    })

    if (!mcpToken?.user) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid token" },
        { status: 401 }
      )
    }

    const userId = mcpToken.user.id
    const syncDate = lastSyncTimestamp ? new Date(lastSyncTimestamp) : new Date(0)
    const currentSyncTimestamp = new Date()

    // Get all lists the user has access to
    const userLists = await prisma.taskList.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { listMembers: { some: { userId: userId } } },
          { listMembers: { some: { userId: userId } } },
          { listMembers: { some: { userId } } }
        ]
      },
      select: { id: true }
    })

    const listIds = userLists.map(l => l.id)

    // Fetch lists changes
    const [createdLists, updatedLists] = await Promise.all([
      // Created lists (after last sync)
      prisma.taskList.findMany({
        where: {
          id: { in: listIds },
          createdAt: { gt: syncDate }
        },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          }
        }
      }),

      // Updated lists (after last sync, but not newly created)
      prisma.taskList.findMany({
        where: {
          id: { in: listIds },
          updatedAt: { gt: syncDate },
          createdAt: { lte: syncDate }
        },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          }
        }
      })
    ])

    // Fetch tasks changes from accessible lists
    const [createdTasks, updatedTasks] = await Promise.all([
      // Created tasks
      prisma.task.findMany({
        where: {
          lists: { some: { id: { in: listIds } } },
          createdAt: { gt: syncDate }
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          },
          lists: {
            select: {
              id: true,
              name: true
            }
          }
        }
      }),

      // Updated tasks
      prisma.task.findMany({
        where: {
          lists: { some: { id: { in: listIds } } },
          updatedAt: { gt: syncDate },
          createdAt: { lte: syncDate }
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true
            }
          },
          lists: {
            select: {
              id: true,
              name: true
            }
          }
        }
      })
    ])

    // Note: We don't track deletions in the current schema
    // Future enhancement: Add soft delete flags or deletion tracking table

    const response = {
      lists: {
        created: createdLists,
        updated: updatedLists,
        deleted: [] // Not implemented yet
      },
      tasks: {
        created: createdTasks,
        updated: updatedTasks,
        deleted: [] // Not implemented yet
      },
      syncTimestamp: currentSyncTimestamp.toISOString(),
      stats: {
        listsCreated: createdLists.length,
        listsUpdated: updatedLists.length,
        tasksCreated: createdTasks.length,
        tasksUpdated: updatedTasks.length
      }
    }

    log.info(`🔄 [Sync] User ${userId}: ${response.stats.listsCreated} lists, ${response.stats.tasksCreated} tasks created; ${response.stats.listsUpdated} lists, ${response.stats.tasksUpdated} tasks updated since ${syncDate.toISOString()}`)

    return NextResponse.json(response)

  } catch (error) {
    log.error({ err: error }, "Error in sync endpoint:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
