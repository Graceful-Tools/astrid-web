import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('settings.reminders.unsubscribe')


export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const reminderSettings = await prisma.reminderSettings.findUnique({
      where: { userId },
    })

    if (!reminderSettings) {
      return NextResponse.json(
        { error: 'Reminder settings not found' },
        { status: 404 }
      )
    }

    await prisma.reminderSettings.update({
      where: { userId },
      data: { enableEmailReminders: false },
    })

    return new NextResponse(
      `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Unsubscribed - Astrid</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background-color: #f9fafb;
            margin: 0;
            padding: 40px 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .container {
            max-width: 500px;
            background-color: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            text-align: center;
          }
          h1 {
            color: #1f2937;
            font-size: 24px;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            font-size: 16px;
            margin-bottom: 24px;
          }
          .button {
            background-color: #3b82f6;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            display: inline-block;
            font-weight: 500;
          }
          .button:hover {
            background-color: #2563eb;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>You've been unsubscribed</h1>
          <p>You will no longer receive email reminders from Astrid.</p>
          <p>You can re-enable email reminders at any time in your settings.</p>
          <a href="/" class="button">Go to Astrid</a>
        </div>
      </body>
      </html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      }
    )
  } catch (error) {
    log.error({ err: error }, 'Error unsubscribing from email reminders:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const reminderSettings = await prisma.reminderSettings.findUnique({
      where: { userId },
    })

    if (!reminderSettings) {
      return NextResponse.json(
        { error: 'Reminder settings not found' },
        { status: 404 }
      )
    }

    await prisma.reminderSettings.update({
      where: { userId },
      data: { enableEmailReminders: false },
    })

    return NextResponse.json({
      success: true,
      message: 'Email reminders disabled successfully',
    })
  } catch (error) {
    log.error({ err: error }, 'Error unsubscribing from email reminders:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
