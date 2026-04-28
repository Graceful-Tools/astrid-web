import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.push-subscription')


const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  }),
  userAgent: z.string().optional()
})

// POST /api/user/push-subscription - Subscribe to push notifications
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = PushSubscriptionSchema.parse(body)

    // Create or update push subscription
    const pushSubscription = await prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: {
          userId: session.user.id,
          endpoint: validatedData.endpoint
        }
      },
      update: {
        p256dh: validatedData.keys.p256dh,
        auth: validatedData.keys.auth,
        userAgent: validatedData.userAgent,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        endpoint: validatedData.endpoint,
        p256dh: validatedData.keys.p256dh,
        auth: validatedData.keys.auth,
        userAgent: validatedData.userAgent,
        isActive: true,
      }
    })

    return NextResponse.json({ 
      success: true, 
      subscriptionId: pushSubscription.id 
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid subscription data', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error creating push subscription:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/user/push-subscription - Unsubscribe from push notifications
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get('endpoint')

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Endpoint parameter is required' },
        { status: 400 }
      )
    }

    // Deactivate the subscription
    const updatedSubscription = await prisma.pushSubscription.updateMany({
      where: {
        userId: session.user.id,
        endpoint: endpoint,
      },
      data: {
        isActive: false,
        updatedAt: new Date(),
      }
    })

    return NextResponse.json({ 
      success: true,
      deactivated: updatedSubscription.count 
    })
  } catch (error) {
    log.error({ err: error }, 'Error deactivating push subscription:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET /api/user/push-subscription - Get user's active push subscriptions
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        userId: session.user.id,
        isActive: true,
      },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      }
    })

    return NextResponse.json(subscriptions)
  } catch (error) {
    log.error({ err: error }, 'Error fetching push subscriptions:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}