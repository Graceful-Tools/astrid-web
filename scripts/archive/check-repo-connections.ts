import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config({ path: '.env.local' })
const prisma = new PrismaClient()

async function checkRepositoryConnections() {
  console.log('🔍 Checking repository connections in lists...\n')

  // Get all lists (check AI agents status from JSON field)
  const allLists = await prisma.taskList.findMany({
    include: {
      owner: {
        include: {
          githubIntegrations: {
            select: {
              installationId: true,
              repositories: true,
              createdAt: true
            }
          }
        }
      }
    }
  })

  // Filter lists that have AI agents enabled
  const listsWithAI = allLists.filter(list => {
    const aiAgents = list.aiAgentsEnabled
    return aiAgents && Array.isArray(aiAgents) && aiAgents.length > 0
  })

  console.log(`📋 Found ${listsWithAI.length} lists with AI agents enabled:\n`)

  for (const list of listsWithAI) {
    const firstIntegration = list.owner.githubIntegrations?.[0]
    console.log(`List: "${list.name}" (ID: ${list.id})`)
    console.log(`  Owner: ${list.owner.name} (${list.owner.email})`)
    console.log(`  GitHub Repository: ${list.githubRepositoryId || '❌ NOT CONFIGURED'}`)
    console.log(`  AI Agents Enabled: ${list.aiAgentsEnabled ? '✅' : '❌'}`)

    if (firstIntegration) {
      console.log(`  GitHub Integration:`)
      console.log(`    Installation ID: ${firstIntegration.installationId}`)
      console.log(`    Connected: ${firstIntegration.createdAt}`)

      if (firstIntegration.repositories) {
        try {
          const reposData = firstIntegration.repositories
          const repos = typeof reposData === 'string' ? JSON.parse(reposData) : reposData
          console.log(`    Available Repositories: ${repos.length}`)
          repos.forEach((repo: any) => {
            const match = list.githubRepositoryId === repo.fullName
            console.log(`      - ${repo.fullName}${match ? ' ✅ (CONFIGURED IN LIST)' : ''}`)
          })
        } catch (e) {
          console.log(`    Repositories: Error parsing (${e instanceof Error ? e.message : 'unknown error'})`)
        }
      }
    } else {
      console.log(`  GitHub Integration: ❌ NOT CONNECTED`)
    }
    console.log()
  }

  // Check "Astrid Bugs & Polish" list specifically
  const astridList = allLists.find(list => list.name === 'Astrid Bugs & Polish')

  if (astridList) {
    const firstIntegration = astridList.owner.githubIntegrations?.[0]
    console.log(`\n🎯 "Astrid Bugs & Polish" List Status:`)
    console.log(`  GitHub Repository: ${astridList.githubRepositoryId || '❌ NOT CONFIGURED'}`)
    const aiAgents = astridList.aiAgentsEnabled
    const hasAI = aiAgents && Array.isArray(aiAgents) && aiAgents.length > 0
    console.log(`  AI Agents Enabled: ${hasAI ? '✅ Yes' : '❌ No'}`)
    console.log(`  Owner: ${astridList.owner.name} (${astridList.owner.email})`)
    console.log(`  Owner GitHub Integration: ${firstIntegration ? '✅ Connected' : '❌ Not Connected'}`)

    if (firstIntegration) {
      console.log(`  Installation ID: ${firstIntegration.installationId}`)
      if (firstIntegration.repositories) {
        try {
          const reposData = firstIntegration.repositories
          const repos = typeof reposData === 'string' ? JSON.parse(reposData) : reposData
          console.log(`  Available Repositories: ${repos.length}`)
          const astridRepo = repos.find((r: any) => r.fullName.includes('astrid-res'))
          if (astridRepo) {
            console.log(`  \n  ⚠️  ISSUE FOUND: Repository not configured in list!`)
            console.log(`     Suggested repository: ${astridRepo.fullName}`)
          }
        } catch (e) {
          console.log(`  Repositories: Error parsing`)
        }
      }
    }
  } else {
    console.log(`\n🎯 "Astrid Bugs & Polish" list not found`)
  }

  await prisma.$disconnect()
}

checkRepositoryConnections().catch(console.error)
