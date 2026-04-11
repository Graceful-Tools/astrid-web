import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

// Load .env.local
config({ path: '.env.local' })

const prisma = new PrismaClient()

async function getTaskByShortId(shortId: string) {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: shortId
      },
      include: {
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { name: true, email: true, isAIAgent: true } }
          }
        },
        assignee: { select: { name: true, isAIAgent: true } },
        aiAgent: { select: { name: true } }
      }
    })

    if (task) {
      console.log('\n📋 Task Details:')
      console.log('Title:', task.title)
      console.log('Description:', task.description || '(none)')
      console.log('Assignee:', task.assignee?.name || '(unassigned)')
      console.log('AI Agent:', task.aiAgent?.name || '(none)')
      console.log('\n💬 Comments (' + task.comments.length + '):')

      for (const comment of task.comments) {
        console.log('\n---')
        console.log('From:', comment.author?.name || "Deleted User", comment.author?.isAIAgent ? '🤖' : '👤')
        console.log('Date:', comment.createdAt.toISOString())
        console.log('Content:', comment.content.substring(0, 500))
        if (comment.content.length > 500) {
          console.log('... [truncated]')
        }
      }
    } else {
      console.log('❌ Task not found:', shortId)
    }
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

const shortId = process.argv[2] || 'vfghieqN'
getTaskByShortId(shortId)
