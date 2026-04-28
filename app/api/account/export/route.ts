import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { createLogger } from '@/lib/logger'

const log = createLogger('account.export')


// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

  // Try database session (mobile app)
  const sessionCookie = request.cookies.get("next-auth.session-token")
    || request.cookies.get("__Secure-next-auth.session-token")
  if (!sessionCookie) {
    return null
  }

  const dbSession = await prisma.session.findUnique({
    where: { sessionToken: sessionCookie.value },
    include: { user: true },
  })

  if (!dbSession || dbSession.expires < new Date()) {
    return null
  }

  return { user: { id: dbSession.user.id } }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const format = searchParams.get("format") || "json" // 'json' or 'csv'

    // Fetch all user data
    const userData = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        // Tasks created by user
        createdTasks: {
          include: {
            lists: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true, email: true } },
            comments: {
              include: {
                author: { select: { id: true, name: true, email: true } }
              }
            },
            attachments: true,
            secureFiles: { select: { id: true, originalName: true, mimeType: true, fileSize: true } }
          }
        },
        // Tasks assigned to user
        assignedTasks: {
          include: {
            lists: { select: { id: true, name: true } },
            creator: { select: { id: true, name: true, email: true } },
            comments: {
              include: {
                author: { select: { id: true, name: true, email: true } }
              }
            }
          }
        },
        // Lists owned by user
        ownedLists: {
          include: {
            tasks: {
              include: {
                assignee: { select: { id: true, name: true, email: true } }
              }
            },
            listMembers: {
              include: {
                user: { select: { id: true, name: true, email: true } }
              }
            }
          }
        },
        // List memberships
        listMemberships: {
          include: {
            list: { select: { id: true, name: true, ownerId: true } },
            user: { select: { id: true, name: true, email: true } }
          }
        },
        // Comments authored by user
        comments: {
          include: {
            task: { select: { id: true, title: true } }
          }
        },
        // Reminder settings
        reminderSettings: true,
        // GitHub integrations (user may have multiple)
        githubIntegrations: {
          select: {
            id: true,
            installationId: true,
            repositories: true,
            createdAt: true,
            updatedAt: true
          }
        },
        // MCP tokens
        mcpTokens: {
          select: {
            id: true,
            description: true,
            permissions: true,
            expiresAt: true,
            createdAt: true,
            isActive: true,
            list: { select: { id: true, name: true } }
          }
        }
      }
    })

    if (!userData) {
      return new NextResponse("User not found", { status: 404 })
    }

    // Prepare export data
    const exportData = {
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        defaultDueTime: userData.defaultDueTime,
        aiAssistantSettings: userData.aiAssistantSettings,
        mcpEnabled: userData.mcpEnabled
      },
      tasks: {
        created: userData.createdTasks.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          completed: task.completed,
          repeating: task.repeating,
          isPrivate: task.isPrivate,
          dueDateTime: task.dueDateTime,
          isAllDay: task.isAllDay,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          lists: task.lists.map(l => ({ id: l.id, name: l.name })),
          assignee: task.assignee,
          comments: task.comments.map(c => ({
            id: c.id,
            content: c.content,
            type: c.type,
            author: c.author,
            createdAt: c.createdAt
          })),
          attachments: task.attachments,
          files: task.secureFiles
        })),
        assigned: userData.assignedTasks.map(task => ({
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          completed: task.completed,
          dueDateTime: task.dueDateTime,
          creator: task.creator,
          lists: task.lists.map(l => ({ id: l.id, name: l.name })),
          comments: task.comments.map(c => ({
            id: c.id,
            content: c.content,
            author: c.author,
            createdAt: c.createdAt
          }))
        }))
      },
      lists: {
        owned: userData.ownedLists.map(list => ({
          id: list.id,
          name: list.name,
          description: list.description,
          color: list.color,
          privacy: list.privacy,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt,
          taskCount: list.tasks.length,
          memberCount: list.listMembers.length,
          tasks: list.tasks.map(t => ({
            id: t.id,
            title: t.title,
            completed: t.completed,
            priority: t.priority,
            assignee: t.assignee
          })),
          members: list.listMembers.map(m => ({
            user: m.user,
            role: m.role,
            joinedAt: m.createdAt
          }))
        })),
        memberOf: userData.listMemberships.map(m => ({
          list: m.list,
          role: m.role,
          joinedAt: m.createdAt
        }))
      },
      comments: userData.comments.map(c => ({
        id: c.id,
        content: c.content,
        type: c.type,
        task: c.task,
        createdAt: c.createdAt
      })),
      settings: {
        reminders: userData.reminderSettings || null,
        githubIntegrations: userData.githubIntegrations || [],
        mcpTokens: userData.mcpTokens
      },
      exportedAt: new Date().toISOString()
    }

    if (format === "csv") {
      // Generate CSV for tasks (flattened view)
      const tasksForCsv = [
        ...exportData.tasks.created.map(t => ({
          taskId: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          completed: t.completed,
          repeating: t.repeating,
          dueDateTime: t.dueDateTime,
          createdAt: t.createdAt,
          role: "Creator",
          lists: t.lists.map(l => l.name).join("; "),
          assignee: t.assignee?.email || "Unassigned",
          commentCount: t.comments.length,
          attachmentCount: t.attachments.length
        })),
        ...exportData.tasks.assigned.map(t => ({
          taskId: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          completed: t.completed,
          repeating: "",
          dueDateTime: t.dueDateTime || "",
          createdAt: "",
          role: "Assignee",
          lists: t.lists.map(l => l.name).join("; "),
          assignee: "Me",
          commentCount: t.comments.length,
          attachmentCount: 0
        }))
      ]

      // Manual CSV generation
      const headers = [
        "taskId",
        "title",
        "description",
        "priority",
        "completed",
        "repeating",
        "dueDateTime",
        "createdAt",
        "role",
        "lists",
        "assignee",
        "commentCount",
        "attachmentCount"
      ]

      const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) return ""
        const stringValue = String(value)
        if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      }

      const csvRows = [
        headers.join(","),
        ...tasksForCsv.map(row =>
          headers.map(header => escapeCsvValue(row[header as keyof typeof row])).join(",")
        )
      ]

      const csv = csvRows.join("\n")

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="astrid-export-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // Default: JSON format
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="astrid-export-${new Date().toISOString().split('T')[0]}.json"`
      }
    })

  } catch (error) {
    log.error({ err: error }, "Export error:")
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}
