/**
 * Test API Keys Script
 * Tests Claude and OpenAI API connections
 */

import { AIOrchestrator } from '@/lib/ai-orchestrator'

async function testClaudeAPI(apiKey: string): Promise<void> {
  console.log('🧪 Testing Claude API connection...')

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hello'
        }]
      })
    })

    if (response.ok) {
      console.log('✅ Claude API: Connection successful!')
      const data = await response.json()
      console.log('📝 Response:', data.content?.[0]?.text || 'Success')
    } else {
      const error = await response.text()
      console.log('❌ Claude API: Connection failed')
      console.log('🔍 Status:', response.status)
      console.log('🔍 Error:', error)
    }
  } catch (error) {
    console.log('❌ Claude API: Network error')
    console.log('🔍 Error:', error)
  }
}

async function testOpenAIAPI(apiKey: string): Promise<void> {
  console.log('🧪 Testing OpenAI API connection...')

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hello'
        }]
      })
    })

    if (response.ok) {
      console.log('✅ OpenAI API: Connection successful!')
      const data = await response.json()
      console.log('📝 Response:', data.choices?.[0]?.message?.content || 'Success')
    } else {
      const error = await response.text()
      console.log('❌ OpenAI API: Connection failed')
      console.log('🔍 Status:', response.status)
      console.log('🔍 Error:', error)
    }
  } catch (error) {
    console.log('❌ OpenAI API: Network error')
    console.log('🔍 Error:', error)
  }
}


async function testUserAPIKeys(userId: string): Promise<void> {
  console.log('🔑 Testing user API keys from database...')

  try {
    const { getCachedApiKey } = await import('@/lib/api-key-cache')

    // Test Claude
    try {
      const claudeKey = await getCachedApiKey(userId, 'claude')
      if (claudeKey) {
        await testClaudeAPI(claudeKey)
      } else {
        console.log('⚠️ No Claude API key found for user')
      }
    } catch (error) {
      console.log('❌ Error testing Claude key:', error)
    }

    // Test OpenAI
    try {
      const openaiKey = await getCachedApiKey(userId, 'openai')
      if (openaiKey) {
        await testOpenAIAPI(openaiKey)
      } else {
        console.log('⚠️ No OpenAI API key found for user')
      }
    } catch (error) {
      console.log('❌ Error testing OpenAI key:', error)
    }


  } catch (error) {
    console.log('❌ Error accessing API keys:', error)
  }
}

async function main() {
  console.log('🔍 API Key Testing Tool')
  console.log('=======================\n')

  // Get user email from command line argument
  const userEmail = process.argv[2]

  if (!userEmail) {
    console.log('❌ Usage: npx tsx scripts/test-api-keys.ts [user-email]')
    console.log('📝 Example: npx tsx scripts/test-api-keys.ts PDD@kuoparis.com')
    process.exit(1)
  }

  try {
    // Find user by email
    const { createScriptPrisma } = await import('./lib/script-prisma')
    const prisma = createScriptPrisma()

    const user = await prisma.user.findUnique({
      where: { email: userEmail }
    })

    if (!user) {
      console.log(`❌ User not found: ${userEmail}`)
      await prisma.$disconnect()
      process.exit(1)
    }

    console.log(`👤 Testing API keys for: ${user.name || user.email}`)
    console.log(`🆔 User ID: ${user.id}\n`)

    await testUserAPIKeys(user.id)

    await prisma.$disconnect()

  } catch (error) {
    console.log('❌ Error:', error)
    process.exit(1)
  }

  console.log('\n🎉 API key testing complete!')
}

// Handle direct execution
if (require.main === module) {
  main().catch(console.error)
}