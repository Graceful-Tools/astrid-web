import { config } from 'dotenv'
import { createScriptPrisma } from './lib/script-prisma'

config({ path: '.env.local' })

const prisma = createScriptPrisma()

async function main() {
  const userId = 'cmeje966q0000k1045si7zrz3'

  console.log(`\n🔍 Checking GitHub integration for user: ${userId}`)

  const integration = await prisma.gitHubIntegration.findFirst({
    where: { userId },
    select: {
      userId: true,
      installationId: true,
      isSharedApp: true,
      appId: true,
      repositories: true,
      createdAt: true,
      updatedAt: true
    }
  })

  if (integration) {
    console.log('\n✅ GitHub Integration Found:')
    console.log(JSON.stringify(integration, null, 2))
  } else {
    console.log('\n❌ No GitHub integration found for this user')
    console.log('\n📋 Next steps:')
    console.log('1. Log in to https://astrid.cc as jonparis@gmail.com')
    console.log('2. Go to Settings → Coding Integration')
    console.log('3. Click "Connect GitHub" and install the GitHub App')
  }
}

main().finally(() => prisma.$disconnect())
