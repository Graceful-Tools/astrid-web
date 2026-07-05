import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Token comes from the env/CLI, never hardcoded (this file is committed).
  const token = process.env.MCP_TOKEN || process.argv[2]
  if (!token) {
    console.error('Usage: MCP_TOKEN=<token> tsx <script>  (or pass as argv[2])')
    process.exit(1)
  }
  
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
