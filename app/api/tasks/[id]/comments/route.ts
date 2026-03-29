import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import type { CreateCommentData } from "@/types/api"
import { hasListAccess } from "@/lib/list-member-utils"
import type { RouteContextParams } from "@/types/next"
import { getAgentService } from "@/lib/ai/agent-config"
import { trackEventFromRequest, AnalyticsEventType } from "@/lib/analytics-events"

// Helper function to safely check list access with any list-like object
function canAccessList(list: any, userId: string): boolean {
  try {
    return hasListAccess(list as any, userId)
  } catch {
    // Fallback to manual check if type casting fails
    if (list.ownerId === userId) return true
    if (list.listMembers?.some((member: any) => member.userId === userId)) return true
    return false
  }
}

export async function GET(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: taskId } = await context.params

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user has access to view comments on this task
    const hasAccess =
      task.assigneeId === session.user.id ||
      task.creatorId === session.user.id ||
      task.lists.some((list: any) => canAccessList(list, session.user.id)) ||
      // Allow viewing comments on public lists (both copy-only and collaborative)
      task.lists.some((list: any) => list.privacy === 'PUBLIC')

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const comments = await prisma.comment.findMany({
      where: {
        taskId,
        parentCommentId: null // Only get top-level comments
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: {
            author: true,
            secureFiles: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    })

    return NextResponse.json(comments)
  } catch (error) {
    console.error("Error fetching comments:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: CreateCommentData = await request.json()
    const { id: taskId } = await context.params

    // Validate required fields - content is required unless there's a fileId
    if (!data.content?.trim() && !data.fileId) {
      return NextResponse.json({ error: "Content or file attachment is required" }, { status: 400 })
    }

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignee: true, // Include assignee for AI agent checks
        lists: {
          include: {
            owner: true,
            listMembers: {
              include: {
                user: true
              }
            },
          },
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Check if user has access to comment on this task
    const hasAccess =
      task.assigneeId === session.user.id ||
      task.creatorId === session.user.id ||
      task.lists.some((list: any) => canAccessList(list, session.user.id)) ||
      // Allow comments on collaborative public lists
      task.lists.some((list: any) => list.privacy === 'PUBLIC' && list.publicListType === 'collaborative')

    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Debug: Log permission check details for POST
    console.log('🔍 Comment permission check POST:', {
      taskId: task.id,
      userId: session.user.id,
      isAssignee: task.assigneeId === session.user.id,
      isCreator: task.creatorId === session.user.id,
      listCount: task.lists.length,
      listIds: task.lists.map(l => l.id)
    })

    // Check each list's access individually for debugging
    task.lists.forEach((list, index) => {
      const listAccess = canAccessList(list, session.user.id)
      console.log(`🔍 List ${index} (${list.id}) access:`, listAccess, {
        isOwner: list.ownerId === session.user.id,
        listMemberCount: list.listMembers?.length || 0
      })
    })

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        content: data.content.trim() || '',
        type: data.type || "TEXT",
        parentCommentId: data.parentCommentId,
        authorId: session.user.id,
        taskId,
      },
      include: {
        author: true,
        secureFiles: true,
        replies: {
          include: {
            author: true,
            secureFiles: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    // Associate secure file if provided
    if (data.fileId) {
      try {
        await prisma.secureFile.update({
          where: {
            id: data.fileId,
            uploadedBy: session.user.id // Security: only allow linking files uploaded by the user
          },
          data: {
            commentId: comment.id
          }
        })

        // Refetch the comment to include the associated file
        const updatedComment = await prisma.comment.findUnique({
          where: { id: comment.id },
          include: {
            author: true,
            secureFiles: true,
            replies: {
              include: {
                author: true,
                secureFiles: true,
              },
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        })

        // Update the comment variable to include the secure file
        if (updatedComment) {
          Object.assign(comment, updatedComment)
        }
      } catch (error) {
        console.error('Failed to associate file with comment:', error)
        // Don't fail the comment creation if file association fails
      }
    }

    // Invalidate user statistics if commenting on someone else's task
    try {
      // Only invalidate if commenting on a task created by someone else
      if (task.creatorId !== session.user.id) {
        const { invalidateUserStats } = await import("@/lib/user-stats")
        // Invalidate comment author's stats (supported tasks count increased)
        await invalidateUserStats(session.user.id)
        console.log(`📊 Invalidated user stats for comment author ${session.user.id}`)
      }
    } catch (statsError) {
      console.error("❌ Failed to invalidate user stats:", statsError)
      // Continue - comment was still created
    }

    // Broadcast real-time updates to relevant users
    try {
      const { broadcastCommentCreatedNotification, broadcastToUsers } = await import("@/lib/sse-utils")
      await broadcastCommentCreatedNotification(task, comment, session.user.id)

      // Broadcast agent_task_comment if task is assigned to an OpenClaw agent
      if (task.assigneeId && task.assignee?.email &&
          (task.assignee.email.match(/\.oc@astrid\.cc$/i) || task.assignee.email === 'openclaw@astrid.cc') &&
          session.user.id !== task.assigneeId) {
        broadcastToUsers([task.assigneeId], {
          type: 'agent_task_comment',
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            comment: {
              id: comment.id,
              content: comment.content,
              authorName: (comment as any).author?.name || (comment as any).author?.email || null,
              authorId: comment.authorId,
              isAgent: false,
              createdAt: new Date(comment.createdAt).toISOString(),
            }
          }
        })
      }

      // Handle @mentions and assignee notifications
      const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g
      const mentionedUserIds = new Set<string>()
      let match
      while ((match = mentionRegex.exec(data.content || '')) !== null) {
        mentionedUserIds.add(match[2])
      }

      const { PushNotificationService } = await import("@/lib/push-notification-service")
      const pushService = new PushNotificationService()
      const commenterName = session.user.name || session.user.email || "Someone"

      // 1. Notify mentioned users
      for (const mentionedUserId of mentionedUserIds) {
        if (mentionedUserId !== session.user.id) {
          await pushService.sendCommentNotification(mentionedUserId, {
            taskId: task.id,
            commentId: comment.id,
            taskTitle: task.title,
            commenterName,
            content: comment.content,
            type: 'mention'
          })
        }
      }

      // 2. Notify assignee if not mentioned and not the commenter
      if (task.assigneeId && 
          task.assigneeId !== session.user.id && 
          !mentionedUserIds.has(task.assigneeId)) {
        await pushService.sendCommentNotification(task.assigneeId, {
          taskId: task.id,
          commentId: comment.id,
          taskTitle: task.title,
          commenterName,
          content: comment.content,
          type: 'assignment'
        })
      }
    } catch (sseError) {
      console.error("Failed to send comment notifications:", sseError)
      // Continue - comment was still created
    }

    // Check for workflow actions in the comment (for coding workflows)
    // But skip workflow processing for AI agent comments to prevent infinite loops
    const commenterUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isAIAgent: true }
    })
    const isCommenterAIAgent = commenterUser?.isAIAgent === true

    if (data.content?.trim() && !isCommenterAIAgent) {
      try {
        const { processCommentForWorkflowAction } = await import('@/lib/comment-approval-detector')

        // Process comment for any workflow action (approve, merge, changes)
        await processCommentForWorkflowAction(taskId, comment.id, data.content, session.user.id)
      } catch (workflowError) {
        console.error('Error processing comment for workflow action:', workflowError)
        // Don't fail the comment creation if workflow processing fails
      }
    } else if (isCommenterAIAgent) {
      console.log(`🤖 Skipped workflow action processing - comment by AI agent`)
    }

    // Notify AI agent if task is assigned to one (but don't notify AI agents about their own comments)
    // (commenterUser and isCommenterAIAgent already determined above)

    // Check if this is a system-generated comment that should not trigger notifications
    const isSystemGenerated = comment.content.includes('<!-- SYSTEM_GENERATED_COMMENT -->')

    // Skip AI agent notifications for:
    // 1. Comments by AI agents themselves (prevent self-notification)
    // 2. System-generated comments (prevent automation loops)
    if (task.assigneeId && task.assignee?.isAIAgent && !isCommenterAIAgent && !isSystemGenerated) {
      try {
        console.log(`🔔 User commented on AI agent task - triggering workflow resume`)
        console.log(`   Comment: "${data.content.substring(0, 100)}..."`)

        // Check if this is a coding agent (new tools-based workflow)
        const isCodingAgent = task.assignee.aiAgentType === 'coding_agent' ||
                             task.assignee.email?.includes('claude@') ||
                             task.assignee.name?.includes('Claude')

        if (isCodingAgent) {
          // ✅ Consolidated: Use AIOrchestrator for all workflows (including comments)
          // Find first list with a repository (task may be in multiple lists)
          const listWithRepo = task.lists?.find(l => l.githubRepositoryId)
          const repository = listWithRepo?.githubRepositoryId

          if (repository) {
            console.log(`🚀 Resuming workflow with user comment via AIOrchestrator`)

            // Import AIOrchestrator (unified system with Phase 1-3 improvements)
            import('@/lib/ai-orchestrator').then(async ({ AIOrchestrator }) => {
              try {
                const configuredByUserId = listWithRepo?.aiAgentConfiguredBy || task.creatorId || session.user.id

                // Find or create workflow record
                let workflow = await prisma.codingTaskWorkflow.findUnique({
                  where: { taskId }
                })

                // Check if workflow already has a PR or has progressed beyond planning
                // If so, don't restart - let processCommentForWorkflowAction handle via handleChangeRequest
                const workflowAlreadyProcessed = workflow && (
                  workflow.pullRequestNumber !== null ||
                  workflow.status === 'TESTING' ||
                  workflow.status === 'COMPLETED' ||
                  workflow.status === 'READY_TO_MERGE'
                )

                if (workflowAlreadyProcessed) {
                  console.log(`📝 [COMMENT] Workflow already processed (status: ${workflow?.status}, PR: ${workflow?.pullRequestNumber})`)
                  console.log(`   Skipping executeCompleteWorkflow - processCommentForWorkflowAction will handle via handleChangeRequest`)
                  return // Don't restart workflow - feedback is handled by processCommentForWorkflowAction
                }

                if (!workflow) {
                  // Determine AI service from the assigned agent's email
                  const aiService = task.assignee?.email ? getAgentService(task.assignee.email) : 'claude'

                  // OpenClaw tasks use the channel plugin (SSE), not the orchestrator workflow
                  if (aiService === 'openclaw') {
                    console.log(`🔌 [COMMENT] Skipping workflow creation — OpenClaw tasks are handled via channel plugin (SSE)`)
                    return
                  }

                  workflow = await prisma.codingTaskWorkflow.create({
                    data: {
                      taskId,
                      status: 'PENDING',
                      aiService,
                      repositoryId: repository,
                      metadata: {
                        triggeredBy: 'user_comment',
                        userComment: data.content,
                        timestamp: new Date().toISOString()
                      }
                    }
                  })
                }

                console.log(`🚀 [COMMENT] Starting AIOrchestrator workflow`)
                console.log(`   Workflow ID: ${workflow.id}`)
                console.log(`   User comment: ${data.content?.substring(0, 100)}...`)

                // Create orchestrator and execute workflow
                const orchestrator = await AIOrchestrator.createForTask(
                  taskId,
                  configuredByUserId!
                )

                // Execute asynchronously
                const workflowId = workflow.id
                orchestrator.executeCompleteWorkflow(workflowId, taskId)
                  .then(() => {
                    console.log(`✅ [COMMENT] AIOrchestrator workflow completed`)
                  })
                  .catch(async (error) => {
                    console.error(`❌ [COMMENT] AIOrchestrator workflow failed:`, error)
                    // Update workflow status to FAILED to prevent stuck workflows
                    try {
                      const { PrismaClient } = await import('@prisma/client')
                      const prismaClient = new PrismaClient()
                      await prismaClient.codingTaskWorkflow.update({
                        where: { id: workflowId },
                        data: {
                          status: 'FAILED',
                          metadata: {
                            error: error.message,
                            failedAt: new Date().toISOString()
                          }
                        }
                      })
                      await prismaClient.$disconnect()
                    } catch (e) {
                      console.error('❌ [COMMENT] Failed to update workflow status:', e)
                    }
                  })

                console.log(`✅ AIOrchestrator workflow started for new task`)
              } catch (error) {
                console.error(`❌ Failed to resume AIOrchestrator workflow:`, error)
              }
            }).catch(err => console.error('❌ Failed to import AIOrchestrator:', err))
          } else {
            console.log(`⚠️ No repository configured, cannot resume workflow`)
          }
        } else {
          // Fall back to old webhook system for other AI agents
          const { aiAgentWebhookService } = await import('@/lib/ai-agent-webhook-service')
          await aiAgentWebhookService.notifyCommentOnAssignedTask(
            taskId,
            comment.id,
            data.content,
            session.user.name || session.user.email || 'Someone'
          )
        }

        console.log(`🔔 Notified AI agent about human comment from ${session.user.name}`)
      } catch (agentError) {
        console.error('Error notifying AI agent about comment:', agentError)
        // Don't fail the comment creation if AI agent notification fails
      }
    } else if (isCommenterAIAgent) {
      console.log(`🤖 Skipped AI agent notification - comment by AI agent itself`)
    } else if (isSystemGenerated) {
      console.log(`🔧 Skipped AI agent notification - system-generated comment`)
    } else if (!task.assignee?.isAIAgent && !isCommenterAIAgent && !isSystemGenerated) {
      // No AI agent assigned to this task — check for a default agent
      try {
        const { resolveDefaultAgent } = await import('@/lib/resolve-default-agent')
        const { ASTRID_EMAIL } = await import('@/lib/astrid-agent')
        const listId = task.lists?.[0]?.id || null
        const defaultAgentId = await resolveDefaultAgent(listId, session.user.id)
        if (defaultAgentId) {
          // Check if default agent is Astrid
          const defaultAgent = await prisma.user.findUnique({
            where: { id: defaultAgentId },
            select: { email: true },
          })

          if (defaultAgent?.email === ASTRID_EMAIL) {
            // Use Astrid runtime to respond
            const { processAstridComment } = await import('@/lib/astrid-agent-runtime')
            processAstridComment({
              commentContent: comment.content,
              userId: session.user.id,
              userName: session.user.name || session.user.email || 'Someone',
              taskId: task.id,
              taskTitle: task.title,
              listId,
            }).catch(err => console.error('[Comments API] Astrid comment error:', err))
          } else {
            // External agent — send SSE event
            const { broadcastToUsers } = await import('@/lib/sse-utils')
            await broadcastToUsers([defaultAgentId], {
              type: 'agent_task_comment',
              timestamp: new Date().toISOString(),
              data: {
                taskId: task.id,
                taskTitle: task.title,
                comment: {
                  id: comment.id,
                  content: comment.content,
                  authorId: session.user.id,
                  authorName: session.user.name || session.user.email || 'Someone',
                },
                isDefaultAgent: true,
              },
            })
          }
          console.log(`🤖 Notified default agent ${defaultAgentId} about comment`)
        }
      } catch (defaultAgentError) {
        console.error('[Comments API] Default agent dispatch error:', defaultAgentError)
      }
    }

    // Track analytics event (fire-and-forget)
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.COMMENT_ADDED, {
      commentId: comment.id,
      taskId
    })

    return NextResponse.json(comment)
  } catch (error) {
    console.error("Error creating comment:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
