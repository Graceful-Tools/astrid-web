/**
 * Debug Encryption Issues
 * Check what's stored in the database vs what we're trying to decrypt
 */

import { PrismaClient } from '@prisma/client'

async function debugEncryption() {
  const prisma = new PrismaClient()

  try {
    console.log('🔍 Debug Encryption Issues\n')

    // Check user's mcpSettings
    const user = await prisma.user.findUnique({
      where: { email: 'pdd@kuoparis.com' },
      select: {
        id: true,
        email: true,
        mcpSettings: true,
        aiAssistantSettings: true
      }
    })

    if (!user) {
      console.log('❌ User not found')
      return
    }

    console.log('👤 User:', user.email)
    console.log('🆔 User ID:', user.id)

    // Check mcpSettings
    if (user.mcpSettings) {
      console.log('\n📊 mcpSettings found:')
      const mcpSettings = JSON.parse(user.mcpSettings)
      console.log('Keys in mcpSettings:', Object.keys(mcpSettings))

      if (mcpSettings.apiKeys) {
        console.log('API Keys found:', Object.keys(mcpSettings.apiKeys))

        for (const [service, keyData] of Object.entries(mcpSettings.apiKeys)) {
          console.log(`\n🔑 ${service}:`)
          console.log('Type:', typeof keyData)
          console.log('Structure:', keyData)
        }
      } else {
        console.log('❌ No apiKeys in mcpSettings')
      }
    } else {
      console.log('❌ No mcpSettings found')
    }

    // Check aiAssistantSettings
    if (user.aiAssistantSettings) {
      console.log('\n📊 aiAssistantSettings found:')
      const aiSettings = JSON.parse(user.aiAssistantSettings)
      console.log('Keys in aiAssistantSettings:', Object.keys(aiSettings))
    } else {
      console.log('❌ No aiAssistantSettings found')
    }

    // Check environment
    console.log('\n🌍 Environment:')
    console.log('ENCRYPTION_KEY exists:', !!process.env.ENCRYPTION_KEY)
    console.log('ENCRYPTION_KEY length:', process.env.ENCRYPTION_KEY?.length || 0)

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

debugEncryption().catch(console.error)