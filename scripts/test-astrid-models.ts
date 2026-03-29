#!/usr/bin/env npx tsx
/**
 * Astrid Model Compatibility Test Harness
 *
 * Tests that Astrid's agent runtime works correctly with each provider's
 * cheapest/free models across all tool-calling capabilities.
 *
 * Usage:
 *   npx tsx scripts/test-astrid-models.ts              # Test all providers
 *   npx tsx scripts/test-astrid-models.ts claude        # Test Claude only
 *   npx tsx scripts/test-astrid-models.ts openai gemini # Test specific providers
 *
 * Prerequisites:
 *   - .env.local with API keys for each provider
 *   - Dev server running (for API calls): npm run dev
 *
 * Cost estimate: ~$0.01-0.05 per full run (cheapest models)
 */

// ─── Config ───────────────────────────────────────────────────────

interface ModelConfig {
  provider: 'claude' | 'openai' | 'gemini'
  model: string
  tier: 'free' | 'cheap' | 'standard'
}

const MODELS_TO_TEST: ModelConfig[] = [
  // Claude — cheapest
  { provider: 'claude', model: 'claude-haiku-4-5-20251001', tier: 'cheap' },
  { provider: 'claude', model: 'claude-sonnet-4-20250514', tier: 'standard' },

  // OpenAI — cheapest
  { provider: 'openai', model: 'gpt-4o-mini', tier: 'cheap' },
  { provider: 'openai', model: 'gpt-4o', tier: 'standard' },

  // Gemini — free tier
  { provider: 'gemini', model: 'gemini-2.0-flash', tier: 'free' },
  { provider: 'gemini', model: 'gemini-2.5-flash', tier: 'free' },
]

// ─── Test Cases ───────────────────────────────────────────────────

interface TestCase {
  name: string
  prompt: string
  /** Check the API call the model should make */
  expectTool: {
    method: string
    pathPattern: RegExp
  }
  /** Optional: check the response text contains keywords */
  expectResponseContains?: string[]
}

const TEST_CASES: TestCase[] = [
  {
    name: 'List tasks',
    prompt: 'How many incomplete tasks do I have?',
    expectTool: { method: 'GET', pathPattern: /\/api\/v1\/tasks/ },
  },
  {
    name: 'Create task',
    prompt: 'Create a task called "Test task from Astrid harness"',
    expectTool: { method: 'POST', pathPattern: /\/api\/v1\/tasks$/ },
  },
  {
    name: 'Update task priority',
    prompt: 'Set the priority of "Test task from Astrid harness" to high',
    expectTool: { method: 'PUT', pathPattern: /\/api\/v1\/tasks\/[a-zA-Z0-9]+/ },
  },
  {
    name: 'Complete task',
    prompt: 'Complete the task "Test task from Astrid harness"',
    expectTool: { method: 'PUT', pathPattern: /\/api\/v1\/tasks\/[a-zA-Z0-9]+/ },
  },
  {
    name: 'Create list',
    prompt: 'Create a new list called "Astrid Test List"',
    expectTool: { method: 'POST', pathPattern: /\/api\/v1\/lists$/ },
  },
  {
    name: 'Add comment',
    prompt: 'Add a comment to "Test task from Astrid harness" saying "This is a test comment"',
    expectTool: { method: 'POST', pathPattern: /\/api\/v1\/tasks\/[a-zA-Z0-9_-]+\/comments/ },
  },
]

// ─── Test Runner ──────────────────────────────────────────────────

interface TestResult {
  model: string
  provider: string
  testName: string
  passed: boolean
  toolCalled: boolean
  toolMethod?: string
  toolPath?: string
  responseSnippet: string
  error?: string
  durationMs: number
}

async function loadApiKey(provider: 'claude' | 'openai' | 'gemini'): Promise<string | null> {
  // Load from environment or .env.local
  const envMap: Record<string, string> = {
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
  }

  const key = process.env[envMap[provider]]
  if (key) return key

  // Try loading from .env.local
  try {
    const fs = await import('fs')
    const path = await import('path')
    const envPath = path.join(process.cwd(), '.env.local')
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(new RegExp(`^${envMap[provider]}=(.+)$`, 'm'))
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
  } catch {
    return null
  }
}

async function callProviderWithToolTracking(
  provider: 'claude' | 'openai' | 'gemini',
  model: string,
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ response: string; toolCalls: Array<{ method: string; path: string }> }> {
  const toolCalls: Array<{ method: string; path: string }> = []

  // Mock tool execution that just records calls
  const TOOL_DEF = [{
    name: 'api_request',
    description: 'Make an authenticated HTTP request to the Astrid API.',
    input_schema: {
      type: 'object' as const,
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path: { type: 'string' },
        body: { type: 'object' },
        query: { type: 'object' },
      },
      required: ['method', 'path'],
    },
  }]

  if (provider === 'claude') {
    let messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: userMessage },
    ]

    for (let i = 0; i < 3; i++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: 512, system: systemPrompt,
          tools: TOOL_DEF, messages,
        }),
      })
      if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
      const data = await res.json()

      const toolBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'tool_use')
      const textBlocks = (data.content || []).filter((b: { type: string }) => b.type === 'text')

      if (toolBlocks.length === 0) {
        return { response: textBlocks.map((b: { text: string }) => b.text).join('\n'), toolCalls }
      }

      messages.push({ role: 'assistant', content: data.content })
      const results = []
      for (const tb of toolBlocks) {
        toolCalls.push({ method: tb.input.method, path: tb.input.path })
        results.push({ type: 'tool_result', tool_use_id: tb.id, content: JSON.stringify({ tasks: [], task: { id: 'test-123', title: 'Test' }, list: { id: 'list-123', name: 'Test' }, success: true }) })
      }
      messages.push({ role: 'user', content: results })
    }
    return { response: 'Max rounds reached', toolCalls }

  } else if (provider === 'openai') {
    const tools = TOOL_DEF.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    let messages: Array<{ role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    for (let i = 0; i < 3; i++) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 512, tools, messages }),
      })
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
      const data = await res.json()
      const msg = data.choices?.[0]?.message

      if (!msg?.tool_calls?.length) {
        return { response: msg?.content || '', toolCalls }
      }

      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        const args = JSON.parse(tc.function.arguments)
        toolCalls.push({ method: args.method, path: args.path })
        messages.push({ role: 'tool', content: JSON.stringify({ tasks: [], task: { id: 'test-123', title: 'Test' }, success: true }), tool_call_id: tc.id })
      }
    }
    return { response: 'Max rounds reached', toolCalls }

  } else {
    // Gemini — with function calling
    const geminiTools = [{
      functionDeclarations: [{
        name: 'api_request',
        description: 'Make an authenticated HTTP request to the Astrid API.',
        parameters: {
          type: 'OBJECT',
          properties: {
            method: { type: 'STRING', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
            path: { type: 'STRING' },
            body: { type: 'OBJECT', properties: {} },
            query: { type: 'OBJECT', properties: {} },
          },
          required: ['method', 'path'],
        },
      }],
    }]

    let contents: Array<{ role: string; parts: unknown[] }> = [
      { role: 'user', parts: [{ text: userMessage }] },
    ]

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: geminiTools,
          generationConfig: { maxOutputTokens: 512 },
        }),
      })
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
      const data = await res.json()

      const parts = data.candidates?.[0]?.content?.parts || []
      const functionCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall)
      const textParts = parts.filter((p: { text?: string }) => p.text)

      if (functionCalls.length === 0) {
        return { response: textParts.map((p: { text: string }) => p.text).join('\n'), toolCalls }
      }

      contents.push({ role: 'model', parts })

      const functionResponses = []
      for (const part of functionCalls) {
        const fc = part.functionCall
        const args = fc.args || {}
        toolCalls.push({ method: args.method, path: args.path })
        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: { tasks: [], task: { id: 'test-123', title: 'Test' }, list: { id: 'list-123', name: 'Test' }, success: true },
          },
        })
      }
      contents.push({ role: 'user', parts: functionResponses })
    }
    return { response: 'Max rounds reached', toolCalls }
  }
}

async function runTest(
  config: ModelConfig,
  testCase: TestCase,
  apiKey: string,
): Promise<TestResult> {
  const start = Date.now()
  const result: TestResult = {
    model: config.model,
    provider: config.provider,
    testName: testCase.name,
    passed: false,
    toolCalled: false,
    responseSnippet: '',
    durationMs: 0,
  }

  try {
    const systemPrompt = `You are Astrid, a task management assistant. You have an api_request tool to make HTTP calls to the Astrid API.

API Endpoints:
- GET /api/v1/tasks — List tasks. Query: listId, completed, limit
- POST /api/v1/tasks — Create task. Body: { title, description?, listIds?, assigneeId?, priority?, dueDateTime? }
- PUT /api/v1/tasks/:id — Update task. Body: any of { title, description, priority, dueDateTime, assigneeId, completed }
- DELETE /api/v1/tasks/:id — Delete task
- POST /api/v1/tasks/:id/comments — Add comment. Body: { content, type?: "MARKDOWN" }
- GET /api/v1/lists — List all lists
- POST /api/v1/lists — Create list. Body: { name, description? }

Current user: Test User (test@example.com, ID: test-user-123)

Current tasks:
- [task-abc] Test task from Astrid harness [P0]
- [task-def] Another task [P1]

Always use the api_request tool to take actions. Be concise.`

    const { response, toolCalls } = await callProviderWithToolTracking(
      config.provider, config.model, apiKey, systemPrompt, testCase.prompt,
    )

    result.responseSnippet = response.substring(0, 100)
    result.durationMs = Date.now() - start

    // Check if the expected tool was called
    result.toolCalled = toolCalls.length > 0
    if (toolCalls.length > 0) {
      const matchingCall = toolCalls.find(tc =>
        tc.method === testCase.expectTool.method &&
        testCase.expectTool.pathPattern.test(tc.path)
      )
      result.toolMethod = toolCalls[0].method
      result.toolPath = toolCalls[0].path
      result.passed = !!matchingCall
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message.substring(0, 200) : 'Unknown error'
    result.durationMs = Date.now() - start
  }

  return result
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const filterProviders = args.length > 0 ? args : null

  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║           Astrid Model Compatibility Test Harness           ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  const modelsToTest = MODELS_TO_TEST.filter(m =>
    !filterProviders || filterProviders.includes(m.provider)
  )

  // Check API keys
  const availableKeys: Record<string, string> = {}
  for (const provider of ['claude', 'openai', 'gemini'] as const) {
    const key = await loadApiKey(provider)
    if (key) {
      availableKeys[provider] = key
      console.log(`  ✅ ${provider} API key found`)
    } else {
      console.log(`  ❌ ${provider} API key missing — skipping`)
    }
  }
  console.log()

  const allResults: TestResult[] = []
  let totalTests = 0
  let totalPassed = 0

  for (const config of modelsToTest) {
    const apiKey = availableKeys[config.provider]
    if (!apiKey) continue

    console.log(`\n━━━ ${config.provider.toUpperCase()} / ${config.model} (${config.tier}) ━━━`)

    for (const testCase of TEST_CASES) {
      totalTests++
      process.stdout.write(`  ${testCase.name}... `)

      const result = await runTest(config, testCase, apiKey)
      allResults.push(result)

      if (result.passed) {
        totalPassed++
        const toolInfo = result.toolCalled ? ` [${result.toolMethod} ${result.toolPath}]` : ' [text-only]'
        console.log(`✅ (${result.durationMs}ms)${toolInfo}`)
      } else if (result.error) {
        console.log(`❌ ERROR: ${result.error}`)
      } else {
        const toolInfo = result.toolCalled ? ` [got: ${result.toolMethod} ${result.toolPath}]` : ' [no tool call]'
        console.log(`❌ FAIL${toolInfo}`)
      }

      // Rate limiting — small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  // Summary
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║                        TEST SUMMARY                         ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  // Group by provider
  const byProvider = new Map<string, TestResult[]>()
  for (const r of allResults) {
    const key = `${r.provider}/${r.model}`
    if (!byProvider.has(key)) byProvider.set(key, [])
    byProvider.get(key)!.push(r)
  }

  for (const [key, results] of byProvider) {
    const passed = results.filter(r => r.passed).length
    const total = results.length
    const status = passed === total ? '✅' : passed > 0 ? '⚠️' : '❌'
    console.log(`  ${status} ${key}: ${passed}/${total} passed`)
    for (const r of results) {
      if (!r.passed) {
        console.log(`     ❌ ${r.testName}: ${r.error || 'tool mismatch'}`)
      }
    }
  }

  console.log(`\n  Total: ${totalPassed}/${totalTests} passed`)
  console.log()

  process.exit(totalPassed === totalTests ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
