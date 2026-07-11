import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('reminders.status')


// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // Filter by reminder type
    const limit = parseInt(searchParams.get('limit') || '50')
    const userEmail = searchParams.get('userEmail') // For debugging specific users

    // Determine which user to query for
    let targetUserId = session.user.id
    
    // If userEmail is provided, look up that user (for debugging purposes)
    if (userEmail) {
      const targetUser = await prisma.user.findUnique({
        where: { email: userEmail },
        select: { id: true }
      })
      
      if (targetUser) {
        targetUserId = targetUser.id
      } else {
        return NextResponse.json(
          { error: `User not found: ${userEmail}` },
          { status: 404 }
        )
      }
    }

    // Build where clause
    const where: any = {
      userId: targetUserId,
      status: 'pending',
      scheduledFor: { gte: new Date() }, // Only future reminders
    }

    if (type) {
      where.type = type
    }

    const reminders = await prisma.reminderQueue.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            dueDateTime: true,
            priority: true,
            completed: true,
            lists: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { scheduledFor: 'asc' },
      take: Math.min(limit, 100), // Max 100 reminders
    })

    // Transform data for client
    const formattedReminders = reminders.map(reminder => ({
      id: reminder.id,
      type: reminder.type,
      scheduledFor: reminder.scheduledFor,
      retryCount: reminder.retryCount,
      snoozeCount: (reminder.data as any)?.snoozeCount || 0,
      task: reminder.task ? {
        id: reminder.task.id,
        title: reminder.task.title,
        description: reminder.task.description,
        dueDateTime: reminder.task.dueDateTime,
        priority: reminder.task.priority,
        completed: reminder.task.completed,
        listNames: reminder.task.lists.map(list => list.name),
      } : null,
    }))

    // Get summary statistics
    const stats = await prisma.reminderQueue.groupBy({
      by: ['type'],
      where: {
        userId: targetUserId,
        status: 'pending',
        scheduledFor: { gte: new Date() },
      },
      _count: { type: true },
    })

    const summary = stats.reduce((acc, stat) => {
      acc[stat.type] = stat._count.type
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      reminders: formattedReminders,
      summary,
      total: formattedReminders.length,
    })
  } catch (error) {
    log.error({ err: error }, 'Error fetching reminder status:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}