import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config({ path: '.env.local' })
const prisma = new PrismaClient()

async function checkList() {
  const listId = '2f2cb6c1-2fa7-4340-900b-7f985207b846'

  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    include: {
      owner: {
        include: {
          githubIntegrations: {
            select: {
              installationId: true,
              repositories: true
            }
          }
        }
      },
      tasks: {
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          assignee: true,
          comments: {
            take: 3,
            orderBy: { createdAt: 'desc' },
            include: {
              author: true
            }
          }
        }
      }
    }
  })

  if (list) {
    console.log('📋 List:', list.name)
    console.log('   ID:', list.id)
    console.log('   Owner:', list.owner.name, `(${list.owner.email})`)
    console.log('   GitHub Repository:', list.githubRepositoryId || '❌ NOT SET')
    console.log('   AI Agents:', JSON.stringify(list.aiAgentsEnabled))

    const firstIntegration = list.owner.githubIntegrations?.[0]
    if (firstIntegration) {
      console.log('\n🔌 GitHub Integration:')
      console.log('   Installation ID:', firstIntegration.installationId)

      if (firstIntegration.repositories) {
        const repos = typeof firstIntegration.repositories === 'string'
          ? JSON.parse(firstIntegration.repositories)
          : firstIntegration.repositories
        console.log('   Available Repos:', repos.length)
        console.log('   First 5:')
        repos.slice(0, 5).forEach((r: any) => {
          console.log('   -', r.fullName)
        })
      }
    } else {
      console.log('\n❌ No GitHub Integration for owner')
    }

    console.log('\n📝 Recent Tasks:')
    list.tasks.forEach((task: any) => {
      console.log('\n   Task:', task.title)
      console.log('   ID:', task.id)
      const assigneeName = task.assignee ? task.assignee.name : 'Unassigned'
      const assigneeEmail = task.assignee ? task.assignee.email : 'N/A'
      console.log('   Assigned to:', assigneeName, `(${assigneeEmail})`)
      const isAI = task.assignee ? task.assignee.isAIAgent : false
      console.log('   Is AI Agent:', isAI)

      if (task.comments.length > 0) {
        console.log('   Recent comments:')
        task.comments.forEach((comment: any) => {
          const preview = comment.content.substring(0, 80)
          console.log('     -', comment.author?.name || "Deleted User" + ':', preview + '...')
        })
      }
    })

    console.log('\n\n🎯 KEY ISSUES:')
    if (!list.githubRepositoryId) {
      console.log('❌ Repository NOT configured in list settings')
      console.log('   → User needs to set githubRepositoryId field')
    }

    const aiAgents = list.aiAgentsEnabled
    if (!aiAgents || (Array.isArray(aiAgents) && aiAgents.length === 0)) {
      console.log('❌ AI Agents NOT enabled in list')
      console.log('   → User needs to enable AI agents in list settings')
    }

    if (!firstIntegration) {
      console.log('❌ Owner has NO GitHub integration')
      console.log('   → Owner needs to connect GitHub App')
    }
  } else {
    console.log('❌ List not found')
  }

  await prisma.$disconnect()
}

checkList()
