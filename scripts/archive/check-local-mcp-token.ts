import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const token = 'astrid_mcp_238e219da271cfb80fdb21e3022c6a81e738adbc03bbfc8b75afe7fa50c3f70d'
  
  console.log('\n🔍 Checking MCP token in local database...')
  
  const mcpToken = await prisma.mCPToken.findFirst({
    where: {
      token,
      isActive: true
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          isAIAgent: true,
          aiAgentType: true
        }
      }
    }
  })

  if (mcpToken) {
    console.log('✅ Token found!')
    console.log('User:', mcpToken.user)
    console.log('Token ID:', mcpToken.id)
    console.log('Expires:', mcpToken.expiresAt || 'Never')
  } else {
    console.log('❌ Token not found in local database')
    
    // Check if any MCP tokens exist
    const allTokens = await prisma.mCPToken.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: { email: true, name: true }
        }
      },
      take: 5
    })
    
    console.log(`\n📋 Active MCP tokens in database: ${allTokens.length}`)
    allTokens.forEach(t => {
      console.log(`  - User: ${t.user.name} (${t.user.email})`)
      console.log(`    Token: ${t.token.substring(0, 20)}...`)
    })
  }
}

main().finally(() => prisma.$disconnect())
