/**
 * Check Claude Code Agent user configuration
 */
import { prisma } from '../lib/prisma'

async function checkClaudeAgentUser() {
  try {
    const user = await prisma.user.findUnique({
      where: { id: 'cmfxyv5180000wzufzocx39id' },
      select: { id: true, name: true, email: true, isAIAgent: true }
    })

    console.log('Claude Code Agent user:', user)

    if (!user) {
      console.log('❌ Claude Code Agent user not found!')
    } else if (!user.isAIAgent) {
      console.log('⚠️ Claude Code Agent user exists but isAIAgent is not true')
    } else {
      console.log('✅ Claude Code Agent user is properly configured')
    }
  } catch (error) {
    console.error('Error checking user:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkClaudeAgentUser()