/**
 * GET /api/v1/users/:userId/profile
 *
 * Public-profile view: user metadata + derived stats + recent shared
 * tasks in PUBLIC lists. Mirrors GET /api/users/:userId/profile (legacy)
 * with an added `meta` envelope.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { getUserStats } from '@/lib/user-stats'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.profile')

type RouteContext = { params: Promise<{ userId: string }> }

export const GET = withAuth<RouteContext>(
  { scopes: ['user:read'], tag: 'v1.users.profile' },
  async (_req, auth, { params }) => {
    try {
      const { userId } = await params
      const isOwnProfile = userId === auth.userId

      const profileUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, image: true,
          createdAt: true, isAIAgent: true, aiAgentType: true,
        },
      })
      if (!profileUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const stats = await getUserStats(userId, true)

      const sharedTasks = await prisma.task.findMany({
        where: {
          OR: [
            { creatorId: userId, lists: { some: { privacy: 'PUBLIC' } } },
            { assigneeId: userId, lists: { some: { privacy: 'PUBLIC' } } },
          ],
          isPrivate: false,
        },
        include: {
          assignee: { select: { id: true, name: true, image: true } },
          creator: { select: { id: true, name: true, image: true } },
          lists: { select: { id: true, name: true, color: true, privacy: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })

      return NextResponse.json({
        user: {
          id: profileUser.id,
          name: profileUser.name,
          image: profileUser.image,
          // Email is disclosed only on your OWN profile — returning any user's
          // email to any authenticated caller is an info-disclosure.
          //
          // There used to be an unconditional `email: profileUser.email` ABOVE
          // this line. A spread of `{}` overrides nothing, so on someone else's
          // profile the earlier value simply survived and this gate never
          // gated. Keep this spread the ONLY place email is set.
          ...(isOwnProfile ? { email: profileUser.email } : {}),
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
        isOwnProfile: auth.userId === userId,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching user profile')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
