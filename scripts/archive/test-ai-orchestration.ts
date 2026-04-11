/**
 * Test AI Orchestration
 * Directly test the AI orchestration for the existing workflow
 */

async function testAIOrchestration() {
  try {
    console.log('🧠 Testing AI Orchestration\n')

    const workflowId = 'cmfsm8vkx00012zh60rq38srw'
    const taskId = '11ea9f7e-11a4-4b10-909d-fe15085db572'
    const userId = 'cmfnfsbp800012ztftuohd4uw'

    console.log('📊 Test Parameters:')
    console.log('   Workflow ID:', workflowId)
    console.log('   Task ID:', taskId)
    console.log('   User ID:', userId)

    console.log('\n🚀 Calling AI orchestration API...')

    const response = await fetch('http://localhost:3000/api/coding-workflow/start-ai-orchestration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workflowId,
        taskId,
        userId
      })
    })

    console.log('📊 Response Status:', response.status)
    console.log('📊 Response Headers:', Object.fromEntries(response.headers.entries()))

    if (response.ok) {
      const result = await response.json()
      console.log('✅ AI orchestration started successfully!')
      console.log('📝 Response:', result)
    } else {
      const errorText = await response.text()
      console.log('❌ AI orchestration failed:')
      console.log('🔍 Error:', errorText)
    }

  } catch (error) {
    console.error('❌ Network error:', error)
  }
}

testAIOrchestration().catch(console.error)