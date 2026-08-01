import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getConsistentDefaultImage } from "@/lib/default-images"
import { listVisibilityWhere } from "@/lib/list-permissions"
import type { CreateListData } from "@/types"
import { RedisCache } from "@/lib/redis"
import { broadcastToUsers } from "@/lib/sse-utils"
import { getListMemberIds } from "@/lib/list-member-utils"
import { getUnifiedSession } from "@/lib/session-utils"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"
import { hydrateListFavorites } from "@/lib/favorites"
import { createLogger } from '@/lib/logger'
import { getDeletionsSince } from '@/lib/deletion-log'

const log = createLogger('api.lists')


// Only select the user fields needed for display (excludes sensitive data like passwords, API keys)
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
} as const

export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check for incremental sync parameter
    const { searchParams } = new URL(request.url)
    const updatedSince = searchParams.get('updatedSince')

    // Build base where clause.
    // Includes project-derived visibility (task 6c20d125) — a project member
    // can see every list in the project without a ListMember row.
    const baseWhere = listVisibilityWhere(session.user.id, { includePublic: true })

    // Add incremental filter if provided
    const where = updatedSince
      ? { ...baseWhere, updatedAt: { gt: new Date(updatedSince) } }
      : baseWhere

    // Use Redis cache only for full syncs (not incremental)
    let lists
    if (!updatedSince) {
      // Full sync - use cache
      const cacheKey = RedisCache.keys.userLists(session.user.id)
      lists = await RedisCache.getOrSet(
        cacheKey,
        async () => {
          log.info(`🔄 Cache miss for user lists: ${session.user.id}`)
          return await prisma.taskList.findMany({
            where,
            include: {
              owner: { select: safeUserSelect },
              listMembers: {
                include: {
                  user: { select: safeUserSelect }
                }
              },
              _count: {
                select: {
                  tasks: true,
                },
              },
            },
            orderBy: [
              { createdAt: "desc" },
            ],
          })
        },
        300 // 5 minutes TTL for lists (updated less frequently)
      )
    } else {
      // Incremental sync - skip cache, fetch directly
      log.info(`📥 Incremental sync for user ${session.user.id} lists since ${updatedSince}`)
      lists = await prisma.taskList.findMany({
        where,
        include: {
          owner: { select: safeUserSelect },
          listMembers: {
            include: {
              user: { select: safeUserSelect }
            }
          },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc", // For incremental, order by update time
        },
      })
      log.info(`✅ Incremental sync returned ${lists.length} updated lists`)
    }

    // Hydrate per-user favorite state
    await hydrateListFavorites(lists, session.user.id)

    // Sort: favorites first by order, then non-favorites by createdAt desc
    lists.sort((a: any, b: any) => {
      if (a.isFavorite && !b.isFavorite) return -1
      if (!a.isFavorite && b.isFavorite) return 1
      if (a.isFavorite && b.isFavorite) return (a.favoriteOrder || 0) - (b.favoriteOrder || 0)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // Batch-fetch defaultAssignee users (avoids N+1 per-list query)
    const assigneeIds = [...new Set(
      lists
        .map((list) => list.defaultAssigneeId)
        .filter((id): id is string => !!id && id !== "unassigned")
    )]
    const assigneeMap = new Map<string, Record<string, unknown>>()
    if (assigneeIds.length > 0) {
      const assignees = await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: safeUserSelect,
      })
      for (const a of assignees) {
        assigneeMap.set(a.id, a)
      }
    }
    const listsWithDefaultAssignees = lists.map((list) => ({
      ...list,
      defaultAssignee: (list.defaultAssigneeId && list.defaultAssigneeId !== "unassigned")
        ? assigneeMap.get(list.defaultAssigneeId) ?? null
        : null,
    }))

    // Return response with timestamp for next incremental sync
    // Deltas also report deleted lists; the client already knows how to drop
    // them (CacheManager.removeList), it just never received any.
    const deletedIds = updatedSince
      ? await getDeletionsSince('list', session.user.id, new Date(updatedSince))
      : undefined

    const response = {
      lists: listsWithDefaultAssignees,
      timestamp: new Date().toISOString(),
      isIncremental: !!updatedSince,
      count: listsWithDefaultAssignees.length,
      ...(deletedIds ? { deletedIds } : {})
    }

    return NextResponse.json(response)
  } catch (error) {
    log.error({ err: error }, "Error fetching lists:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: CreateListData = await request.json()

    // Validate required fields
    if (!data.name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 })
    }

    // Create the list first to get the ID, then assign consistent default image
    const listData: any = {
      name: data.name.trim(),
      description: data.description,
      color: data.color || "#3b82f6",
      privacy: data.privacy,
      imageUrl: data.imageUrl, // Use provided imageUrl or null
      ownerId: session.user.id,
      projectId: data.projectId || null,
      listType: data.listType || "regular",
      statusRole: data.statusRole || null,
      statusOrder: data.statusOrder ?? null,
      statusDescription: data.statusDescription || null,
      statusCompleted: data.statusCompleted ?? data.statusRole === "done",
    }

    // Only include optional fields if they have values
    if (data.defaultAssigneeId !== undefined) {
      listData.defaultAssigneeId = data.defaultAssigneeId
    }
    if (data.defaultPriority !== undefined) {
      listData.defaultPriority = data.defaultPriority
    }
    if (data.defaultRepeating !== undefined) {
      listData.defaultRepeating = data.defaultRepeating
    }
    if (data.defaultIsPrivate !== undefined) {
      listData.defaultIsPrivate = data.defaultIsPrivate
    }
    if (data.defaultDueDate !== undefined) {
      listData.defaultDueDate = data.defaultDueDate
    }

    let list: any
    try {
      // Create the list first
      list = await prisma.taskList.create({
        data: listData,
        include: {
          owner: { select: safeUserSelect },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      })

      // Then add admins and members to ListMember table
      if (data.adminIds && data.adminIds.length > 0) {
        await Promise.all(
          data.adminIds.map((userId: string) =>
            prisma.listMember.create({
              data: {
                listId: list.id,
                userId: userId,
                role: 'admin'
              }
            })
          )
        )
      }

      if (data.memberIds && data.memberIds.length > 0) {
        await Promise.all(
          data.memberIds.map((userId: string) =>
            prisma.listMember.create({
              data: {
                listId: list.id,
                userId: userId,
                role: 'member'
              }
            })
          )
        )
      }
    } catch (error) {
      log.error({ err: error }, 'Error creating list:')
      return NextResponse.json({
        error: 'Failed to create list',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 400 })
    }

    // If no imageUrl was provided, assign a consistent default based on the list ID
    let updatedList = list
    if (list && !list.imageUrl) {
      const consistentImage = getConsistentDefaultImage(list.id)
      updatedList = await prisma.taskList.update({
        where: { id: list.id },
        data: { imageUrl: consistentImage.filename },
        include: {
          owner: { select: safeUserSelect },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      })
    }

    // Manually fetch defaultAssignee if it's a valid user ID (not "unassigned")
    let defaultAssignee = null
    if (updatedList?.defaultAssigneeId && updatedList.defaultAssigneeId !== "unassigned") {
      defaultAssignee = await prisma.user.findUnique({
        where: { id: updatedList.defaultAssigneeId },
        select: safeUserSelect
      })
    }

    const listWithDefaultAssignee = {
      ...updatedList,
      defaultAssignee
    }

    // Also populate the new ListMember table for the unified member management
    const memberEntries = []
    
    // Add the list creator as an admin member
    memberEntries.push({
      listId: listWithDefaultAssignee.id,
      userId: session.user.id,
      role: 'admin'
    })
    
    if (data.adminIds) {
      for (const adminId of data.adminIds) {
        // Skip the creator since we already added them
        if (adminId !== session.user.id) {
          memberEntries.push({
            listId: listWithDefaultAssignee.id,
            userId: adminId,
            role: 'admin'
          })
        }
      }
    }
    
    if (data.memberIds) {
      for (const memberId of data.memberIds) {
        // Skip the creator since we already added them as admin
        if (memberId !== session.user.id) {
          memberEntries.push({
            listId: listWithDefaultAssignee.id,
            userId: memberId,
            role: 'member'
          })
        }
      }
    }
    
    // Handle memberEmails from list creation
    if (data.memberEmails && Array.isArray(data.memberEmails)) {
      for (const email of data.memberEmails) {
        const trimmedEmail = email.trim().toLowerCase()
        if (!trimmedEmail) continue
        
        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: trimmedEmail }
        })
        
        if (existingUser) {
          // Skip the creator since we already added them as admin
          if (existingUser.id !== session.user.id) {
            memberEntries.push({
              listId: listWithDefaultAssignee.id,
              userId: existingUser.id,
              role: 'member'
            })
          }
        } else {
          // Create placeholder user for email invitations
          const placeholderUser = await prisma.user.create({
            data: {
              email: trimmedEmail,
              name: null
            }
          })
          
          memberEntries.push({
            listId: listWithDefaultAssignee.id,
            userId: placeholderUser.id,
            role: 'member'
          })
        }
      }
    }
    
    await prisma.listMember.createMany({
      data: memberEntries,
      skipDuplicates: true
    })

    // Send invitations for member emails
    if (data.memberEmails && Array.isArray(data.memberEmails)) {
      const { sendListInvitationEmail } = await import("@/lib/email")
      
      for (const email of data.memberEmails) {
        const trimmedEmail = email.trim().toLowerCase()
        if (!trimmedEmail || trimmedEmail === session.user.email?.toLowerCase()) continue
        
        try {
          // Generate invitation token
          const crypto = await import("crypto")
          const token = crypto.randomBytes(32).toString('hex')
          
          // Create invitation record
          await prisma.listInvite.create({
            data: {
              listId: listWithDefaultAssignee.id,
              email: trimmedEmail,
              token,
              role: 'member',
              createdBy: session.user.id
            }
          })

          // Send invitation email
          await sendListInvitationEmail({
            to: trimmedEmail,
            inviterName: session.user.name || session.user.email || "Someone",
            listName: listWithDefaultAssignee.name,
            role: "member",
            invitationUrl: `${process.env.NEXTAUTH_URL}/invite/${token}`,
          })
        } catch (emailError) {
          log.error({ err: emailError }, `Failed to send invitation to ${trimmedEmail}:`)
          // Continue with other invitations even if one fails
        }
      }
    }

    // Invalidate cache for all users who now have access to this list
    const userIdsToInvalidate = [
      session.user.id, // Creator
      ...(data.adminIds || []), // Admins
      ...(data.memberIds || []), // Members
    ]
    
    // Also add users from email invitations
    if (data.memberEmails && Array.isArray(data.memberEmails)) {
      for (const email of data.memberEmails) {
        const trimmedEmail = email.trim().toLowerCase()
        if (!trimmedEmail) continue
        
        const existingUser = await prisma.user.findUnique({
          where: { email: trimmedEmail }
        })
        
        if (existingUser && !userIdsToInvalidate.includes(existingUser.id)) {
          userIdsToInvalidate.push(existingUser.id)
        }
      }
    }

    log.info({ userCount: userIdsToInvalidate.length }, "🗄️ Invalidating cache for users after list creation")
    await Promise.all(
      [...new Set(userIdsToInvalidate)].map(async (userId) => { // Remove duplicates with Set
        try {
          await RedisCache.del(RedisCache.keys.userLists(userId))
          log.info(`✅ Cache invalidated for user: ${userId}`)
        } catch (error) {
          log.error({ err: error }, `❌ Failed to invalidate cache for user ${userId}:`)
        }
      })
    )

    // Broadcast SSE event for list creation
    try {
      log.info(`[SSE] Broadcasting list creation to ${userIdsToInvalidate.length} users`)
      await broadcastToUsers([...new Set(userIdsToInvalidate)], {
        type: 'list_created',
        timestamp: new Date().toISOString(),
        data: listWithDefaultAssignee
      })
    } catch (sseError) {
      log.error({ err: sseError }, 'Failed to broadcast list creation SSE event:')
      // Don't fail the request if SSE fails
    }

    // Invalidate public lists cache if new list is public
    if (data.privacy === 'PUBLIC') {
      log.info(`🗑️ Invalidating public lists cache for new public list`)
      await RedisCache.delPattern('public_lists:*').catch(err =>
        log.error({ err: err }, 'Failed to invalidate public lists cache:')
      )
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.LIST_ADDED, { listId: listWithDefaultAssignee.id })

    return NextResponse.json(listWithDefaultAssignee)
  } catch (error) {
    log.error({ err: error }, "Error creating list:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
