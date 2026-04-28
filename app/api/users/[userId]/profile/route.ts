import { type NextRequest, NextResponse } from "next/server"
import { authenticateAPI } from "@/lib/api-auth-middleware"
import { prisma } from "@/lib/prisma"
import { getUserStats } from "@/lib/user-stats"
import { createLogger } from '@/lib/logger'

const log = createLogger('users.[userId].profile')


export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    // Use authenticateAPI which supports both web (NextAuth) and iOS (database sessions)
    const auth = await authenticateAPI(request)

    const { userId } = await context.params
    log.info(`[User Profile API] Fetching profile for userId: ${userId}, requested by: ${auth.userId} (${auth.user.email || 'no email'})`)

    // Get the profile user's information
    const profileUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
        isAIAgent: true,
        aiAgentType: true,
        statsCompletedTasks: true,
        statsInspiredTasks: true,
        statsSupportedTasks: true,
        statsLastCalculated: true,
      },
    })

    if (!profileUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Get current user to check for shared tasks
    const currentUser = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true },
    })

    if (!currentUser) {
      return NextResponse.json({ error: "Current user not found" }, { status: 404 })
    }

    // Get user statistics (always force refresh for profile views to ensure accuracy)
    log.info(`[User Profile API] Getting stats for user: ${userId} (forceRefresh=true)`)
    const stats = await getUserStats(userId, true)
    log.info({ stats }, `[User Profile API] Stats retrieved:`)

    // Get tasks visible on profile (only PUBLIC list tasks)
    // Profile should show what others would see - only tasks in PUBLIC lists
    // This applies to both self-view and viewing others' profiles
    log.info(`[User Profile API] Fetching public tasks for profile...`)
    const sharedTasks = await prisma.task.findMany({
      where: {
        OR: [
          // Tasks created by profile user in PUBLIC lists
          {
            creatorId: userId,
            lists: {
              some: {
                privacy: "PUBLIC",
              },
            },
          },
          // Tasks assigned to profile user in PUBLIC lists
          {
            assigneeId: userId,
            lists: {
              some: {
                privacy: "PUBLIC",
              },
            },
          },
        ],
        // Don't show private tasks
        isPrivate: false,
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        lists: {
          select: {
            id: true,
            name: true,
            color: true,
            privacy: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20, // Limit to recent 20 shared tasks
    })

    // Format response
    return NextResponse.json({
      user: {
        id: profileUser.id,
        name: profileUser.name,
        email: profileUser.email,
        image: profileUser.image,
        createdAt: profileUser.createdAt,
        isAIAgent: profileUser.isAIAgent,
        aiAgentType: profileUser.aiAgentType,
      },
      stats: {
        completed: stats.completedTasks,
        inspired: stats.inspiredTasks,
        supported: stats.supportedTasks,
      },
      sharedTasks,
      isOwnProfile: currentUser.id === userId,
    })
  } catch (error) {
    log.error({ err: error }, "[User Profile API] Error fetching user profile:")

    // Return appropriate error based on error type
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(
      { error: "Failed to fetch user profile", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
