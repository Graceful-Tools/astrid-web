import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { encryptField } from '@/lib/field-encryption'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('push.subscribe')


const PushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string(),
    }),
  }),
  userEmail: z.string().email().optional(), // For testing with different users
})

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { subscription, userEmail } = PushSubscriptionSchema.parse(body)

    // Determine target user (for testing purposes)
    const targetEmail = userEmail || session.user.email
    
    // Get target user
    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
      select: { id: true, email: true }
    })

    if (!user) {
      return NextResponse.json({ 
        error: `User not found: ${targetEmail}` 
      }, { status: 404 })
    }

    log.info(`🔔 Setting up push subscription for user ${user.email} (${user.id})`)

    // Check if subscription already exists
    const existingSubscription = await prisma.pushSubscription.findFirst({
      where: {
        userId: user.id,
        endpoint: subscription.endpoint,
      },
    })

    if (existingSubscription) {
      // Update existing subscription to active
      // Encrypt sensitive keys before storage
      await prisma.pushSubscription.update({
        where: { id: existingSubscription.id },
        data: {
          isActive: true,
          p256dh: encryptField(subscription.keys.p256dh),
          auth: encryptField(subscription.keys.auth),
        },
      })
      
      log.info(`🔔 Updated existing push subscription for user ${user.email}`)
      
      return NextResponse.json({
        success: true,
        message: 'Push subscription updated successfully',
        subscriptionId: existingSubscription.id,
      })
    }

    // Create new subscription with encrypted keys
    const newSubscription = await prisma.pushSubscription.create({
      data: {
        userId: user.id,
        endpoint: subscription.endpoint,
        p256dh: encryptField(subscription.keys.p256dh),
        auth: encryptField(subscription.keys.auth),
        isActive: true,
      },
    })

    log.info(`🔔 Created new push subscription for user ${user.email}: ${newSubscription.id}`)

    return NextResponse.json({
      success: true,
      message: `Push subscription created for ${user.email}`,
      subscriptionId: newSubscription.id,
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Invalid subscription data', 
        details: error.errors 
      }, { status: 400 })
    }
    
    log.error({ err: error }, 'Error saving push subscription:')
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}