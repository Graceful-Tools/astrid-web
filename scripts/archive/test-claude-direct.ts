/**
 * Script to test Claude API with a direct API key
 * Usage: CLAUDE_API_KEY="your-key-here" npx tsx scripts/test-claude-direct.ts
 */

async function testClaudeDirectly() {
  console.log('🧪 Testing Claude API with direct API key...')

  const apiKey = process.env.CLAUDE_API_KEY

  if (!apiKey) {
    console.log('❌ Please provide CLAUDE_API_KEY environment variable')
    console.log('Usage: CLAUDE_API_KEY="your-key-here" npx tsx scripts/test-claude-direct.ts')
    return
  }

  console.log('✅ API key provided, testing Claude API call...')

  try {
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
    console.log('💡 Now go to Settings → AI Agents and re-enter this API key to fix the encryption issue')

  } catch (error) {
    console.error('❌ Error testing Claude API:', error)
  }
}

// Run the test
if (require.main === module) {
  testClaudeDirectly()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error)
      process.exit(1)
    })
}

export { testClaudeDirectly }