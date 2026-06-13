import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].upload-image')


// Allowed image extensions and their corresponding MIME types
const ALLOWED_IMAGE_TYPES: Record<string, string[]> = {
  'jpg': ['image/jpeg'],
  'jpeg': ['image/jpeg'],
  'png': ['image/png'],
  'gif': ['image/gif'],
  'webp': ['image/webp'],
}

const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_IMAGE_TYPES)
const ALLOWED_MIME_TYPES = Object.values(ALLOWED_IMAGE_TYPES).flat()

function validateImageFile(file: File): { valid: boolean; mimeType: string; error?: string } {
  // Get extension from filename (lowercase, no dots)
  const filenameParts = file.name.toLowerCase().split('.')
  const extension = filenameParts.length > 1 ? filenameParts.pop() || '' : ''

  // Check if extension is in whitelist
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      valid: false,
      mimeType: '',
      error: `File extension not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    }
  }

  // Check if MIME type matches the extension
  const allowedMimeTypes = ALLOWED_IMAGE_TYPES[extension]
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      mimeType: '',
      error: `File type mismatch. Expected ${allowedMimeTypes.join(' or ')} for .${extension} file`
    }
  }

  return { valid: true, mimeType: file.type }
}

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params
    const formData = await request.formData()
    const file = formData.get('image') as File

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "Image file is required" }, { status: 400 })
    }

    // Validate file extension and MIME type
    const validation = validateImageFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Convert file to base64 data URL for storing in database
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString('base64')
    const imageUrl = `data:${validation.mimeType};base64,${base64}`

    // Get the list and verify permissions
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      include: {
        owner: true,
        listMembers: {
          include: {
            user: true
          }
        },
        // Project membership grants access to project lists (sub-task #3).
        project: {
          select: {
            ownerId: true,
            members: { select: { userId: true, role: true } },
          },
        },
      },
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user can manage the list (owner or admin). Admin can also come
    // from being the project owner / a project admin (sub-task #3). Additive.
    const isOwner = list.ownerId === session.user.id
    const isAdmin = list.listMembers?.some((lm: any) => lm.userId === session.user.id && lm.role === 'admin')
    const isProjectAdmin =
      list.project?.ownerId === session.user.id ||
      list.project?.members?.some(
        (m) => m.userId === session.user.id && (m.role === 'admin' || m.role === 'owner')
      )

    if (!isOwner && !isAdmin && !isProjectAdmin) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Update the list with the new image URL
    const updatedList = await prisma.taskList.update({
      where: { id: listId },
      data: {
        imageUrl: imageUrl,
      },
      include: {
        owner: true,
        _count: {
          select: { tasks: true }
        }
      }
    })

    // Manually fetch defaultAssignee if it's a valid user ID (not "unassigned")
    let defaultAssignee = null
    if (updatedList.defaultAssigneeId && updatedList.defaultAssigneeId !== "unassigned") {
      defaultAssignee = await prisma.user.findUnique({
        where: { id: updatedList.defaultAssigneeId }
      })
    }

    const listWithDefaultAssignee = {
      ...updatedList,
      defaultAssignee
    }

    return NextResponse.json({
      success: true,
      imageUrl: listWithDefaultAssignee.imageUrl,
      list: listWithDefaultAssignee
    })

  } catch (error) {
    log.error({ err: error }, "Error uploading list image:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
