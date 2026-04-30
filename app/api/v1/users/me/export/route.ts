/**
 * GET /api/v1/users/me/export?format=json|csv
 *
 * Returns a downloadable file (Content-Disposition: attachment) of the
 * authenticated user's data. Supports `?format=json` (default) and
 * `?format=csv` (flattened task view). Mirrors GET /api/account/export.
 *
 * No `meta` envelope — the response body is a file, not a JSON wrapper.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.export')

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.export' },
  async (req, auth) => {
    try {
      const { searchParams } = new URL(req.url)
      const format = searchParams.get('format') || 'json'

      const userData = await prisma.user.findUnique({
        where: { id: auth.userId },
        include: {
          createdTasks: {
            include: {
              lists: { select: { id: true, name: true } },
              assignee: { select: { id: true, name: true, email: true } },
              comments: {
                include: {
                  author: { select: { id: true, name: true, email: true } },
                },
              },
              attachments: true,
              secureFiles: { select: { id: true, originalName: true, mimeType: true, fileSize: true } },
            },
          },
          assignedTasks: {
            include: {
              lists: { select: { id: true, name: true } },
              creator: { select: { id: true, name: true, email: true } },
              comments: {
                include: {
                  author: { select: { id: true, name: true, email: true } },
                },
              },
            },
          },
          ownedLists: {
            include: {
              tasks: {
                include: {
                  assignee: { select: { id: true, name: true, email: true } },
                },
              },
              listMembers: {
                include: {
                  user: { select: { id: true, name: true, email: true } },
                },
              },
            },
          },
          listMemberships: {
            include: {
              list: { select: { id: true, name: true, ownerId: true } },
              user: { select: { id: true, name: true, email: true } },
            },
          },
          comments: { include: { task: { select: { id: true, title: true } } } },
          reminderSettings: true,
          githubIntegrations: {
            select: {
              id: true, installationId: true, repositories: true,
              createdAt: true, updatedAt: true,
            },
          },
          mcpTokens: {
            select: {
              id: true, description: true, permissions: true,
              expiresAt: true, createdAt: true, isActive: true,
              list: { select: { id: true, name: true } },
            },
          },
        },
      })
      if (!userData) {
        return new NextResponse('User not found', { status: 404 })
      }

      const exportData = {
        user: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt,
          defaultDueTime: userData.defaultDueTime,
          aiAssistantSettings: userData.aiAssistantSettings,
          mcpEnabled: userData.mcpEnabled,
        },
        tasks: {
          created: userData.createdTasks.map(t => ({
            id: t.id, title: t.title, description: t.description,
            priority: t.priority, completed: t.completed,
            repeating: t.repeating, isPrivate: t.isPrivate,
            dueDateTime: t.dueDateTime, isAllDay: t.isAllDay,
            createdAt: t.createdAt, updatedAt: t.updatedAt,
            lists: t.lists, assignee: t.assignee,
            comments: t.comments.map(c => ({
              id: c.id, content: c.content, type: c.type,
              author: c.author, createdAt: c.createdAt,
            })),
            attachments: t.attachments,
            files: t.secureFiles,
          })),
          assigned: userData.assignedTasks.map(t => ({
            id: t.id, title: t.title, description: t.description,
            priority: t.priority, completed: t.completed,
            dueDateTime: t.dueDateTime,
            creator: t.creator,
            lists: t.lists,
            comments: t.comments.map(c => ({
              id: c.id, content: c.content, author: c.author,
              createdAt: c.createdAt,
            })),
          })),
        },
        lists: {
          owned: userData.ownedLists.map(l => ({
            id: l.id, name: l.name, description: l.description,
            color: l.color, privacy: l.privacy,
            createdAt: l.createdAt, updatedAt: l.updatedAt,
            taskCount: l.tasks.length, memberCount: l.listMembers.length,
            tasks: l.tasks.map(t => ({
              id: t.id, title: t.title, completed: t.completed,
              priority: t.priority, assignee: t.assignee,
            })),
            members: l.listMembers.map(m => ({
              user: m.user, role: m.role, joinedAt: m.createdAt,
            })),
          })),
          memberOf: userData.listMemberships.map(m => ({
            list: m.list, role: m.role, joinedAt: m.createdAt,
          })),
        },
        comments: userData.comments.map(c => ({
          id: c.id, content: c.content, type: c.type,
          task: c.task, createdAt: c.createdAt,
        })),
        settings: {
          reminders: userData.reminderSettings ?? null,
          githubIntegrations: userData.githubIntegrations ?? [],
          mcpTokens: userData.mcpTokens,
        },
        exportedAt: new Date().toISOString(),
      }

      const dateStr = new Date().toISOString().split('T')[0]

      if (format === 'csv') {
        const tasksForCsv = [
          ...exportData.tasks.created.map(t => ({
            taskId: t.id, title: t.title, description: t.description,
            priority: t.priority, completed: t.completed,
            repeating: t.repeating,
            dueDateTime: t.dueDateTime, createdAt: t.createdAt,
            role: 'Creator',
            lists: t.lists.map(l => l.name).join('; '),
            assignee: t.assignee?.email || 'Unassigned',
            commentCount: t.comments.length,
            attachmentCount: t.attachments.length,
          })),
          ...exportData.tasks.assigned.map(t => ({
            taskId: t.id, title: t.title, description: t.description,
            priority: t.priority, completed: t.completed,
            repeating: '', dueDateTime: t.dueDateTime || '',
            createdAt: '', role: 'Assignee',
            lists: t.lists.map(l => l.name).join('; '),
            assignee: 'Me',
            commentCount: t.comments.length,
            attachmentCount: 0,
          })),
        ]
        const headers = [
          'taskId', 'title', 'description', 'priority', 'completed',
          'repeating', 'dueDateTime', 'createdAt', 'role', 'lists',
          'assignee', 'commentCount', 'attachmentCount',
        ]
        const csvRows = [
          headers.join(','),
          ...tasksForCsv.map(row =>
            headers.map(h => escapeCsvValue(row[h as keyof typeof row])).join(',')
          ),
        ]
        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="astrid-export-${dateStr}.csv"`,
          },
        })
      }

      return new NextResponse(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="astrid-export-${dateStr}.json"`,
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Export error')
      return new NextResponse('Internal Server Error', { status: 500 })
    }
  }
)
