import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { prisma } from "@/lib/prisma"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'
import { validateUploadFile, IMAGE_FILE_TYPES } from '@/lib/upload-validation'
import { canUserManageList } from "@/lib/list-permissions"
import { updateListWithImageOwnership } from "@/lib/images/update-list-image"

const log = createLogger('lists.[id].upload-image')


export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
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
    const validation = validateUploadFile(file, IMAGE_FILE_TYPES)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Convert file to base64 data URL for storing in database
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString('base64')
    // file.type is the VALIDATED mime here: validateUploadFile only
    // succeeds when file.type is in the allowlist for this extension, which
    // is exactly what the old local helper returned as `mimeType`.
    const imageUrl = `data:${file.type};base64,${base64}`

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
      },
    })

    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 })
    }

    // Check if user can manage the list (owner or admin).
    if (!canUserManageList({ id: session.user.id }, list as never)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    // Update the list with the new image URL
    const updatedList = await updateListWithImageOwnership({
      listId,
      previousImageUrl: list.imageUrl,
      nextImageUrl: imageUrl,
      userId: session.user.id,
      update: client => client.taskList.update({
        where: { id: listId },
        data: { imageUrl },
        include: {
          owner: true,
          _count: {
            select: { tasks: true }
          }
        }
      }),
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
