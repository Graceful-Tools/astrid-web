import { createScriptPrisma } from './lib/script-prisma'
import { config } from 'dotenv'

config({ path: '.env.local' })
const prisma = createScriptPrisma()

async function configureRepository() {
  const listId = '2f2cb6c1-2fa7-4340-900b-7f985207b846'
  const repository = 'jonparis/quote_vote' // The only available repo for this user

  console.log('🔧 Configuring GitHub repository for list...')
  console.log('   List ID:', listId)
  console.log('   Repository:', repository)

  try {
    // Get current list
    const list = await prisma.taskList.findUnique({
      where: { id: listId },
      select: {
        name: true,
        githubRepositoryId: true,
        aiAgentsEnabled: true
      }
    })

    if (!list) {
      console.log('❌ List not found')
      return
    }

    console.log('\n📋 Current Configuration:')
    console.log('   List Name:', list.name)
    console.log('   Current Repository:', list.githubRepositoryId || 'NOT SET')
    console.log('   AI Agents:', JSON.stringify(list.aiAgentsEnabled))

    // Update repository
    const updated = await prisma.taskList.update({
      where: { id: listId },
      data: {
        githubRepositoryId: repository
      }
    })

    console.log('\n✅ Repository configured successfully!')
    console.log('   New Repository:', updated.githubRepositoryId)
    console.log('\n🎯 The AI agent can now create branches and PRs in:', repository)
    console.log('\n📝 Next: Assign a task to "Claude Code Agent" to test the integration')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

configureRepository()
