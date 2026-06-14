/**
 * POST /api/v1/tasks/copy
 *
 * Copy a single task into one or more target lists. Mirrors POST
 * /api/tasks/copy (batch-copy form). Returns the canonical Task with
 * relations under `task`, plus a `meta` envelope.
 *
 * Body: { taskId, targetListIds[], assigneeId? }
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.copy.batch')

export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.tasks.copy.batch' },
  async (req, auth) => {
    try {
      const data = await req.json() as {
        taskId?: string
        targetListIds?: string[]
        assigneeId?: string | null
      }

      if (!data.taskId || !data.targetListIds?.length) {
        return NextResponse.json(
          { error: 'Task ID and target list IDs are required' },
          { status: 400 }
        )
      }

      const originalTask = await prisma.task.findUnique({
        where: { id: data.taskId },
        include: { lists: true },
      })
      if (!originalTask) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }

      const isPublic = originalTask.lists.some(l => l.privacy === 'PUBLIC')
        && !originalTask.isPrivate
      if (!isPublic) {
        const hasAccess =
          originalTask.assigneeId === auth.userId ||
          originalTask.creatorId === auth.userId ||
          originalTask.lists.some(
            (l: { ownerId: string; listMembers?: { userId: string }[] }) =>
              l.ownerId === auth.userId ||
              l.listMembers?.some(lm => lm.userId === auth.userId)
          )
        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }

      const targetLists = await prisma.taskList.findMany({
        where: {
          id: { in: data.targetListIds },
          OR: [
            { ownerId: auth.userId },
            { listMembers: { some: { userId: auth.userId } } },
          ],
        },
        select: { id: true, name: true, ownerId: true, defaultAssigneeId: true },
      })
      if (targetLists.length !== data.targetListIds.length) {
        return NextResponse.json(
          { error: 'Access denied to one or more target lists' },
          { status: 403 }
        )
      }

      let finalAssigneeId: string | null = auth.userId
      if (data.assigneeId !== undefined) {
        finalAssigneeId = data.assigneeId
      } else if (targetLists.length > 0) {
        const firstList = targetLists[0]
        if (firstList.defaultAssigneeId !== undefined) {
          if (firstList.defaultAssigneeId === null) {
            finalAssigneeId = auth.userId
          } else if (firstList.defaultAssigneeId === 'unassigned') {
            finalAssigneeId = null
          } else {
            finalAssigneeId = firstList.defaultAssigneeId
          }
        } else {
          finalAssigneeId = null
        }
      }

      const copiedTask = await prisma.task.create({
        data: {
          title: originalTask.title,
          description: originalTask.description,
          priority: originalTask.priority,
          repeating: originalTask.repeating,
          isPrivate: originalTask.isPrivate,
          dueDateTime: originalTask.dueDateTime,
          isAllDay: originalTask.isAllDay,
          assigneeId: finalAssigneeId,
          creatorId: auth.userId,
          originalTaskId: originalTask.id,
          sourceListId: originalTask.lists[0]?.id,
          lists: { connect: data.targetListIds.map(id => ({ id })) },
        },
        include: {
          assignee: true,
          creator: true,
          lists: { include: { owner: true } },
          comments: { include: { author: true } },
        },
      })

      return NextResponse.json({
        task: copiedTask,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error copying task (batch)')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
