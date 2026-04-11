/**
 * Script to test Claude API integration
 */

import { getCachedApiKey } from '../lib/api-key-cache'

async function testClaudeAPI() {
  console.log('🧪 Testing Claude API integration...')

  try {
    // Try to get API key for a specific user
    const userId = 'cmfnfrt4m00002ztf4q5lvquz' // The user we saw in logs
    console.log(`🔑 Testing API key for user: ${userId}`)

    const apiKey = await getCachedApiKey(userId, 'claude')

    if (!apiKey) {
      console.log('❌ No API key found - please configure Claude API key in Settings → AI Agents')
      return
    }

    console.log('✅ API key found, testing Claude API call...')

    // Test Claude API with a simple request
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: 'Hello! Please respond with just "API test successful" to confirm the connection is working.'
          }
        ]
      })
    })

    if (!response.ok) {
      let errorDetails = response.statusText
      try {
        const errorBody = await response.text()
        errorDetails = `${response.statusText} - ${errorBody}`
        console.log('❌ Claude API Error Details:', errorDetails)
      } catch (e) {
        console.log('❌ Claude API Error:', errorDetails)
      }
      return
    }

    const data = await response.json()
    const responseText = data.content[0].text

    console.log('✅ Claude API Response:', responseText)
    console.log('🎉 Claude API integration is working!')

  } catch (error) {
    console.error('❌ Error testing Claude API:', error)
  }
}

// Run the test
if (require.main === module) {
  testClaudeAPI()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error)
      process.exit(1)
    })
}

export { testClaudeAPI }