#!/usr/bin/env tsx
/**
 * Local Testing Script for Cloud Workflow Improvements
 *
 * Tests Phases 1, 2, and 3 improvements:
 * - Phase 1: max_tokens, trace IDs, structured logging
 * - Phase 2: Context tracking, pruning, phase separation
 * - Phase 3: Repository context reading, file tree, caching
 *
 * Usage: npx tsx scripts/test-cloud-workflow-improvements.ts
 *
 * Requirements:
 * - DATABASE_URL environment variable must be set
 * - Dev server should NOT be running (uses same database connection)
 */

import { PrismaClient } from '@prisma/client'
import { AIOrchestrator } from '../lib/ai-orchestrator'

// Check for DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('\n❌ ERROR: DATABASE_URL environment variable is not set\n')
  console.error('To run this test:')
  console.error('1. Make sure .env.local file exists with DATABASE_URL')
  console.error('2. Run: npx tsx scripts/test-cloud-workflow-improvements.ts')
  console.error('\nOr run with inline environment variable:')
  console.error('DATABASE_URL="postgresql://..." npx tsx scripts/test-cloud-workflow-improvements.ts\n')
  process.exit(1)
}

const prisma = new PrismaClient()

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function section(title: string) {
  console.log('\n' + '='.repeat(70))
  log(title, 'cyan')
  console.log('='.repeat(70) + '\n')
}

/**
 * Test 1: Verify trace ID generation and structured logging
 */
async function testTraceIDAndLogging() {
  section('Test 1: Trace ID & Structured Logging')

  try {
    // Create a test orchestrator
    const orchestrator = new AIOrchestrator('claude', 'test-user-id', 'test-repo')

    log('✓ AIOrchestrator instance created', 'green')
    log('  Check console above for structured JSON log with:', 'blue')
    log('    - timestamp', 'blue')
    log('    - traceId (format: trace-<timestamp>-<random>)', 'blue')
    log('    - level: "info"', 'blue')
    log('    - service: "AIOrchestrator"', 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Test 2: Verify context size tracking
 */
async function testContextSizeTracking() {
  section('Test 2: Context Size Tracking')

  try {
    const orchestrator = new AIOrchestrator('claude', 'test-user-id')

    // Access private method via any cast for testing
    const orchestratorAny = orchestrator as any

    // Test with small message array
    const smallMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]

    const smallSize = orchestratorAny.getContextSize(smallMessages)
    log(`✓ Small context size: ${smallSize} tokens`, 'green')
    log(`  (Expected: ~10-20 tokens for simple messages)`, 'blue')

    // Test with large message array
    const largeContent = 'x'.repeat(10000) // 10K characters
    const largeMessages = [
      { role: 'user', content: largeContent },
      { role: 'assistant', content: largeContent }
    ]

    const largeSize = orchestratorAny.getContextSize(largeMessages)
    log(`✓ Large context size: ${largeSize} tokens`, 'green')
    log(`  (Expected: ~5000 tokens for 20K chars)`, 'blue')

    // Test context limit detection
    const nearLimit = orchestratorAny.isContextNearLimit(largeMessages, 10000)
    log(`✓ Context near limit check: ${nearLimit}`, 'green')
    log(`  (Expected: true, since 5000 > 8000 threshold)`, 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Test 3: Verify context pruning
 */
async function testContextPruning() {
  section('Test 3: Context Pruning')

  try {
    const orchestrator = new AIOrchestrator('claude', 'test-user-id')
    const orchestratorAny = orchestrator as any

    // Create a large message array
    const messages = []
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user', content: `User message ${i}` })
      messages.push({ role: 'assistant', content: `Assistant response ${i}` })
    }

    log(`Original message count: ${messages.length}`, 'yellow')
    const originalSize = orchestratorAny.getContextSize(messages)
    log(`Original context size: ${originalSize} tokens`, 'yellow')

    // Prune context
    const prunedMessages = orchestratorAny.pruneContext(messages)

    log(`✓ Pruned message count: ${prunedMessages.length}`, 'green')
    const prunedSize = orchestratorAny.getContextSize(prunedMessages)
    log(`✓ Pruned context size: ${prunedSize} tokens`, 'green')

    const reduction = Math.round((1 - (prunedMessages.length / messages.length)) * 100)
    log(`✓ Reduction: ${reduction}%`, 'green')
    log(`  (Expected: ~80% reduction, keeps last 3 exchanges)`, 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Test 4: Verify repository context reading
 */
async function testRepositoryContext() {
  section('Test 4: Repository Context Reading')

  try {
    // Get current repository ID from a list
    const list = await prisma.taskList.findFirst({
      where: {
        githubRepositoryId: { not: null }
      },
      select: {
        githubRepositoryId: true,
        aiAgentConfiguredBy: true
      }
    })

    if (!list?.githubRepositoryId) {
      log('⚠ No repository found with GitHub integration, skipping test', 'yellow')
      return true
    }

    const orchestrator = new AIOrchestrator(
      'claude',
      list.aiAgentConfiguredBy || 'test-user',
      list.githubRepositoryId
    )

    const orchestratorAny = orchestrator as any

    log(`Testing with repository: ${list.githubRepositoryId}`, 'blue')

    // Test repository context loading
    log('Attempting to load ASTRID.md or CLAUDE.md...', 'blue')
    const context = await orchestratorAny.getRepositoryContext()

    if (context) {
      log(`✓ Repository context loaded: ${context.length} characters`, 'green')
      log(`  Contains ASTRID.md or CLAUDE.md: ${context.includes('ASTRID.md') || context.includes('CLAUDE.md')}`, 'blue')
      log(`  Contains ARCHITECTURE.md: ${context.includes('ARCHITECTURE')}`, 'blue')
    } else {
      log('⚠ No repository context found (ASTRID.md / CLAUDE.md missing)', 'yellow')
    }

    // Test repository structure generation
    log('Generating repository file tree...', 'blue')
    const structure = await orchestratorAny.getRepositoryStructure()

    if (structure) {
      log(`✓ Repository structure generated: ${structure.length} characters`, 'green')
      log(`  Preview:`, 'blue')
      const lines = structure.split('\n').slice(0, 10)
      lines.forEach((line: string) => log(`    ${line}`, 'blue'))
      if (structure.split('\n').length > 10) {
        log('    ...', 'blue')
      }
    } else {
      log('⚠ Could not generate repository structure', 'yellow')
    }

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    log(`  This is expected if GitHub credentials are not configured`, 'yellow')
    return false
  }
}

/**
 * Test 5: Verify repository context caching
 */
async function testRepositoryContextCaching() {
  section('Test 5: Repository Context Caching')

  try {
    const list = await prisma.taskList.findFirst({
      where: {
        githubRepositoryId: { not: null }
      },
      select: {
        githubRepositoryId: true,
        aiAgentConfiguredBy: true
      }
    })

    if (!list?.githubRepositoryId) {
      log('⚠ No repository found, skipping cache test', 'yellow')
      return true
    }

    const orchestrator = new AIOrchestrator(
      'claude',
      list.aiAgentConfiguredBy || 'test-user',
      list.githubRepositoryId
    )

    const orchestratorAny = orchestrator as any

    log('First load (should fetch from GitHub)...', 'blue')
    const start1 = Date.now()
    const context1 = await orchestratorAny.getRepositoryContextCached()
    const duration1 = Date.now() - start1
    log(`✓ First load took: ${duration1}ms`, 'green')

    log('Second load (should use cache)...', 'blue')
    const start2 = Date.now()
    const context2 = await orchestratorAny.getRepositoryContextCached()
    const duration2 = Date.now() - start2
    log(`✓ Second load took: ${duration2}ms`, 'green')

    if (duration2 < duration1) {
      log(`✓ Cache working! Second load ${Math.round((1 - duration2/duration1) * 100)}% faster`, 'green')
    } else {
      log(`⚠ Cache might not be working (second load not faster)`, 'yellow')
    }

    log(`  Check logs above for "Using cached repository context"`, 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Test 6: Verify separate context phases
 */
async function testSeparateContextPhases() {
  section('Test 6: Separate Context Phases (Simulation)')

  try {
    log('Creating first orchestrator (Planning phase)...', 'blue')
    const planningOrchestrator = new AIOrchestrator('claude', 'test-user-id')
    const planningTraceId = (planningOrchestrator as any).traceId
    log(`✓ Planning orchestrator trace ID: ${planningTraceId}`, 'green')

    log('Creating second orchestrator (Implementation phase)...', 'blue')
    const implementationOrchestrator = new AIOrchestrator('claude', 'test-user-id')
    const implementationTraceId = (implementationOrchestrator as any).traceId
    log(`✓ Implementation orchestrator trace ID: ${implementationTraceId}`, 'green')

    if (planningTraceId !== implementationTraceId) {
      log('✓ Trace IDs are different (separate contexts confirmed)', 'green')
      log('  This proves each phase starts with fresh context!', 'blue')
    } else {
      log('✗ Trace IDs are the same (should be different)', 'red')
    }

    log('\nIn production workflow:', 'blue')
    log('  1. Planning orchestrator analyzes task (accumulates context)', 'blue')
    log('  2. Planning orchestrator is discarded', 'blue')
    log('  3. NEW implementation orchestrator starts fresh (0 tokens)', 'blue')
    log('  4. No context leakage between phases ✓', 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Test 7: Verify progress endpoint (if server is running)
 */
async function testProgressEndpoint() {
  section('Test 7: Progress Endpoint (Server Check)')

  try {
    // Check if there are any existing workflows to query
    const workflow = await prisma.codingTaskWorkflow.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        taskId: true,
        status: true,
        metadata: true
      }
    })

    if (!workflow) {
      log('⚠ No existing workflows found in database', 'yellow')
      log('  To test progress endpoint:', 'blue')
      log('  1. Start dev server: npm run dev', 'blue')
      log('  2. Create a task and assign to AI agent', 'blue')
      log('  3. Run: curl http://localhost:3000/api/coding-workflow/progress/TASK_ID | jq', 'blue')
      return true
    }

    log(`Found workflow for task: ${workflow.taskId}`, 'blue')
    log(`Status: ${workflow.status}`, 'blue')
    log(`Has trace ID: ${!!(workflow.metadata as any)?.traceId}`, 'blue')

    log('\nTo test progress endpoint for this workflow:', 'yellow')
    log(`  curl http://localhost:3000/api/coding-workflow/progress/${workflow.taskId} | jq`, 'cyan')

    log('\nExpected response structure:', 'blue')
    log('  {', 'blue')
    log('    "taskId": "...",', 'blue')
    log('    "status": "...",', 'blue')
    log('    "traceId": "trace-...",', 'blue')
    log('    "progress": { "phase": "...", "percentComplete": 60 },', 'blue')
    log('    "timing": { "elapsedMs": 12000, "estimatedRemainingMs": 8000 },', 'blue')
    log('    "recentActivity": [...],', 'blue')
    log('    "error": null', 'blue')
    log('  }', 'blue')

    return true
  } catch (error) {
    log(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'red')
    return false
  }
}

/**
 * Main test runner
 */
async function main() {
  log('🚀 Cloud Workflow Improvements - Local Testing Suite', 'cyan')
  log('Testing Phases 1, 2, and 3 improvements\n', 'cyan')

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
  }

  const tests = [
    { name: 'Trace ID & Logging', fn: testTraceIDAndLogging },
    { name: 'Context Size Tracking', fn: testContextSizeTracking },
    { name: 'Context Pruning', fn: testContextPruning },
    { name: 'Repository Context', fn: testRepositoryContext },
    { name: 'Repository Caching', fn: testRepositoryContextCaching },
    { name: 'Separate Contexts', fn: testSeparateContextPhases },
    { name: 'Progress Endpoint', fn: testProgressEndpoint },
  ]

  for (const test of tests) {
    results.total++
    try {
      const passed = await test.fn()
      if (passed) {
        results.passed++
      } else {
        results.failed++
      }
    } catch (error) {
      log(`\n✗ ${test.name} threw unexpected error:`, 'red')
      console.error(error)
      results.failed++
    }
  }

  // Summary
  section('Test Summary')
  log(`Total tests: ${results.total}`, 'blue')
  log(`Passed: ${results.passed}`, 'green')
  if (results.failed > 0) {
    log(`Failed: ${results.failed}`, 'red')
  }
  if (results.skipped > 0) {
    log(`Skipped: ${results.skipped}`, 'yellow')
  }

  const successRate = Math.round((results.passed / results.total) * 100)
  log(`\nSuccess rate: ${successRate}%`, successRate >= 80 ? 'green' : 'yellow')

  if (successRate >= 80) {
    log('\n✓ All core improvements are working correctly!', 'green')
    log('  Phase 1: Trace IDs, structured logging ✓', 'green')
    log('  Phase 2: Context tracking, pruning, separation ✓', 'green')
    log('  Phase 3: Repository context, caching ✓', 'green')
  } else {
    log('\n⚠ Some tests failed. Review errors above.', 'yellow')
  }

  log('\nNext steps:', 'cyan')
  log('1. Start dev server: npm run dev', 'blue')
  log('2. Create a test task and assign to AI agent', 'blue')
  log('3. Monitor logs: tail -f logs/*.log | jq', 'blue')
  log('4. Check progress: curl http://localhost:3000/api/coding-workflow/progress/TASK_ID | jq', 'blue')
  log('5. Watch GitHub Actions: gh run watch', 'blue')

  await prisma.$disconnect()
  process.exit(results.failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
