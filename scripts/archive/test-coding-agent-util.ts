import { isCodingAgent, isCodingAgentType } from '../lib/ai-agent-utils'

const testCases = [
  { aiAgentType: 'coding_agent', isAIAgent: true },
  { aiAgentType: 'claude_agent', isAIAgent: true },
  { aiAgentType: 'openai_agent', isAIAgent: true },
  { aiAgentType: 'other_agent', isAIAgent: true },
  { aiAgentType: null, isAIAgent: true },
]

console.log('Testing isCodingAgentType:')
console.log('coding_agent:', isCodingAgentType('coding_agent'))
console.log('claude_agent:', isCodingAgentType('claude_agent'))
console.log('openai_agent:', isCodingAgentType('openai_agent'))
console.log('other_agent:', isCodingAgentType('other_agent'))

console.log('\nTesting isCodingAgent:')
testCases.forEach(testCase => {
  console.log(`${testCase.aiAgentType}:`, isCodingAgent(testCase))
})
