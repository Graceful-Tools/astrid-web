/**
 * Chat Channels API
 *
 * POST /api/chat/channels — get-or-create a channel for a listId or virtualKey
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { listId, virtualKey } = body

    if (!listId && !virtualKey) {
      return NextResponse.json(
        { error: 'Either listId or virtualKey is required' },
        { status: 400 }
      )
    }

    // For real list channels, verify the user has access to the list
    if (listId) {
      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        include: { listMembers: true },
      })

      if (!list) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 })
      }

      const isOwner = list.ownerId === session.user.id
      const isMember = list.listMembers?.some(m => m.userId === session.user.id)
      const isPublicCollaborative = list.privacy === 'PUBLIC' && list.publicListType === 'collaborative'

      if (!isOwner && !isMember && !isPublicCollaborative) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Get or create channel for this list
      const channel = await prisma.chatChannel.upsert({
        where: { listId },
        create: { listId, name: list.name },
        update: {},
      })

      return NextResponse.json({ channel })
    }

    // For virtual channels, verify the user owns the virtualKey
    if (virtualKey) {
      // Format: "virtual-chat:{userId}:{type}"
      const parts = virtualKey.split(':')
      if (parts.length < 3 || parts[1] !== session.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const channel = await prisma.chatChannel.upsert({
        where: { virtualKey },
        create: { virtualKey, name: parts[2] || 'Chat' },
        update: {},
      })

      return NextResponse.json({ channel })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('[Chat API] POST /chat/channels error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
